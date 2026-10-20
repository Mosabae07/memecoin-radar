#!/usr/bin/env python3
"""
Memecoin Radar: an early-signal scanner for Solana meme coins.

Every run (GitHub Actions, every 15 minutes):
  1. DISCOVER  new token profiles, boosts and community takeovers on DexScreener,
               plus every coin still on the watchlist from earlier runs
  2. MEASURE   live pair stats (price, volume, buys/sells, liquidity, market cap)
  3. SKEPTIC   throw out anything dead, dumped, too thin or with scam markers,
               using RugCheck's full report on the coins that survive the basics
  4. SCORE     rank survivors on momentum that is *accelerating*, not just big
  5. PAPER     open pretend trades on top picks and manage them on later runs
  6. PUBLISH   write docs/data/*.json for the dashboard

It never buys anything. Scores are signals, not predictions, and most new meme
coins still go to zero. Free data only: DexScreener and RugCheck need no key.
X (Twitter) buzz comes from docs/data/buzz.json, written by the laptop reader.

Standard library only, so the GitHub runner needs no installs.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'docs', 'data')
DEX = 'https://api.dexscreener.com'
RUG = 'https://api.rugcheck.xyz/v1'
UA = {'User-Agent': 'memecoin-radar/1.0 (+github actions)', 'Accept': 'application/json'}

# ---------------------------------------------------------------- settings
CFG = {
    'chain': 'solana',
    'watch_hours': 24,             # keep re-checking a coin this long after first sight
    'max_watch': 150,              # cap on coins re-checked per run
    'max_rugchecks': 12,           # full RugCheck reports per run (be polite)
    # hard filters (the Skeptic's automatic "skip")
    'min_mcap': 15_000,
    'max_mcap': 5_000_000,
    'min_liq_usd': 8_000,          # graduated pools only; bonding-curve coins report none
    'min_liq_ratio': 0.04,         # liquidity / market cap
    'min_txns_h1': 60,
    'max_drop_h24': -60,           # % from 24h start; below this it already dumped
    'max_age_days': 7,
    'max_top10_pct': 35,           # top 10 holders excluding pools and known accounts
    'max_insider_pct': 15,
    'max_creator_pct': 5,
    'max_network_pct': 20,         # linked insider wallet groups, combined
    # paper trading
    'pick_score': 70,              # score needed to open a paper trade
    'stake_usd': 100,
    'take_profit': 1.00,           # +100%
    'stop_loss': -0.35,            # -35%
    'max_hold_hours': 24,
    'round_trip_cost': 0.04,       # fees + slippage on thin coins, charged on close
    'max_open': 10,
}


def now_ms():
    return int(time.time() * 1000)


def iso(ms=None):
    ms = now_ms() if ms is None else ms
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def get_json(url, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=25) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            if e.code == 429 and i < tries - 1:
                time.sleep(5 * (i + 1))
                continue
            if e.code in (400, 404):
                return None
            if i == tries - 1:
                print(f'  ! {url} -> HTTP {e.code}', file=sys.stderr)
                return None
        except Exception as e:  # network blip
            if i == tries - 1:
                print(f'  ! {url} -> {e}', file=sys.stderr)
                return None
            time.sleep(2)
    return None


def load(name, default):
    p = os.path.join(DATA, name)
    try:
        with open(p, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def save(name, obj):
    os.makedirs(DATA, exist_ok=True)
    p = os.path.join(DATA, name)
    tmp = p + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(obj, f, indent=1, ensure_ascii=False)
    os.replace(tmp, p)


# ---------------------------------------------------------------- 1. discover
def discover(fetch):
    """Token addresses from DexScreener's free feeds, with their profile links."""
    found = {}
    feeds = [('/token-profiles/latest/v1', 'new profile'),
             ('/community-takeovers/latest/v1', 'community takeover'),
             ('/token-boosts/latest/v1', 'paid boost'),
             ('/token-boosts/top/v1', 'paid boost')]
    for path, why in feeds:
        rows = fetch(DEX + path) or []
        for r in rows:
            if r.get('chainId') != CFG['chain'] or not r.get('tokenAddress'):
                continue
            a = r['tokenAddress']
            f = found.setdefault(a, {'sources': set(), 'links': [], 'boost': 0, 'desc': ''})
            f['sources'].add(why)
            f['boost'] = max(f['boost'], r.get('totalAmount') or r.get('amount') or 0)
            if r.get('links') and not f['links']:
                f['links'] = [{'type': l.get('type') or l.get('label') or 'website', 'url': l.get('url')}
                              for l in r['links'] if l.get('url')]
            if r.get('description') and not f['desc']:
                f['desc'] = r['description'][:240]
    return found


def pairs_for(addresses, fetch):
    """Best (most liquid / most traded) pair per token, 30 tokens per request."""
    best = {}
    addrs = list(addresses)
    for i in range(0, len(addrs), 30):
        rows = fetch(f"{DEX}/tokens/v1/{CFG['chain']}/{','.join(addrs[i:i + 30])}") or []
        for p in rows:
            a = (p.get('baseToken') or {}).get('address')
            if not a:
                continue
            key = ((p.get('liquidity') or {}).get('usd') or 0, (p.get('volume') or {}).get('h24') or 0)
            cur = best.get(a)
            if cur is None or key > cur[0]:
                best[a] = (key, p)
        time.sleep(0.3)
    return {a: v[1] for a, v in best.items()}


# ---------------------------------------------------------------- 2. measure
def f0(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


def measure(p):
    tx = p.get('txns') or {}
    vol = p.get('volume') or {}
    ch = p.get('priceChange') or {}
    liq = (p.get('liquidity') or {}).get('usd')
    b = lambda w: (tx.get(w) or {}).get('buys') or 0
    s = lambda w: (tx.get(w) or {}).get('sells') or 0
    created = p.get('pairCreatedAt') or now_ms()
    return {
        'symbol': (p.get('baseToken') or {}).get('symbol', '?'),
        'name': (p.get('baseToken') or {}).get('name', ''),
        'dex': p.get('dexId', ''),
        'quote': (p.get('quoteToken') or {}).get('symbol', ''),
        'url': p.get('url', ''),
        'price': f0(p.get('priceUsd')),
        'mcap': f0(p.get('marketCap') or p.get('fdv')),
        'liq': None if liq is None else f0(liq),
        'buys_m5': b('m5'), 'sells_m5': s('m5'),
        'buys_h1': b('h1'), 'sells_h1': s('h1'),
        'buys_h24': b('h24'), 'sells_h24': s('h24'),
        'vol_m5': f0(vol.get('m5')), 'vol_h1': f0(vol.get('h1')), 'vol_h24': f0(vol.get('h24')),
        'chg_m5': f0(ch.get('m5')), 'chg_h1': f0(ch.get('h1')), 'chg_h24': f0(ch.get('h24')),
        'age_h': max(0.0, (now_ms() - created) / 3_600_000),
        'socials': sorted({(s_.get('type') or '') for s_ in ((p.get('info') or {}).get('socials') or [])} - {''}),
        'websites': len((p.get('info') or {}).get('websites') or []),
    }


# ---------------------------------------------------------------- 3. skeptic
def basic_flags(m):
    """Cheap checks on DexScreener numbers alone. Any hit = skip."""
    f = []
    if m['price'] <= 0 or m['mcap'] <= 0:
        f.append('no usable price data')
    if m['mcap'] < CFG['min_mcap']:
        f.append(f"market cap ${m['mcap']:,.0f} is below ${CFG['min_mcap']:,}: too early to tell a launch from a dud")
    if m['mcap'] > CFG['max_mcap']:
        f.append(f"market cap ${m['mcap']:,.0f}: no longer early")
    if m['chg_h24'] <= CFG['max_drop_h24']:
        f.append(f"already dumped: down {abs(m['chg_h24']):.0f}% in 24h")
    if m['buys_h1'] + m['sells_h1'] < CFG['min_txns_h1']:
        f.append(f"only {m['buys_h1'] + m['sells_h1']} trades in the last hour: no real activity")
    if m['age_h'] > CFG['max_age_days'] * 24:
        f.append(f"{m['age_h'] / 24:.0f} days old: not early")
    if m['liq'] is not None:  # graduated pool; bonding-curve coins report no liquidity
        if m['liq'] < CFG['min_liq_usd']:
            f.append(f"liquidity ${m['liq']:,.0f} is too thin to exit")
        elif m['mcap'] and m['liq'] / m['mcap'] < CFG['min_liq_ratio']:
            f.append(f"liquidity is only {100 * m['liq'] / m['mcap']:.1f}% of market cap: price is easy to crash")
    return f


def rug_report(addr, fetch):
    r = fetch(f'{RUG}/tokens/{addr}/report')
    if not r:
        return None
    # skip pools/AMMs when counting whales, but keep the creator's wallet in
    known = {k for k, v in (r.get('knownAccounts') or {}).items() if (v or {}).get('type') != 'CREATOR'}
    pools = {m.get('pubkey') for m in (r.get('markets') or [])} | {
        (m.get('liquidityA') or '') for m in (r.get('markets') or [])} | {
        (m.get('liquidityB') or '') for m in (r.get('markets') or [])}
    holders = [h for h in (r.get('topHolders') or [])
               if h.get('owner') not in known and h.get('address') not in pools and h.get('owner') not in pools]
    top10 = sum(f0(h.get('pct')) for h in holders[:10])
    insider_pct = sum(f0(h.get('pct')) for h in (r.get('topHolders') or []) if h.get('insider'))
    supply = f0(((r.get('token') or {}).get('supply')))
    creator_pct = 100 * f0(r.get('creatorBalance')) / supply if supply else 0.0
    # wallets RugCheck links together (funded from the same source): how much they still hold
    net_pct = 100 * sum(f0(n.get('currentHolding') or n.get('tokenAmount'))
                        for n in (r.get('insiderNetworks') or [])) / supply if supply else 0.0
    return {
        'mint_authority': bool(r.get('mintAuthority')),
        'freeze_authority': bool(r.get('freezeAuthority')),
        'rugged': bool(r.get('rugged')),
        'holders': int(r.get('totalHolders') or 0),
        'top10_pct': round(top10, 1),
        'insider_pct': round(insider_pct, 1),
        'insider_networks': len(r.get('insiderNetworks') or []),
        'insider_net_pct': round(net_pct, 1),
        'insiders_detected': int(r.get('graphInsidersDetected') or 0),
        'creator_pct': round(creator_pct, 2),
        'creator_tokens': len(r.get('creatorTokens') or []),
        'danger': [x.get('name') for x in (r.get('risks') or []) if x.get('level') == 'danger'],
        'warn': [x.get('name') for x in (r.get('risks') or []) if x.get('level') == 'warn'],
    }


def rug_flags(rc):
    f = []
    if rc is None:
        return ['RugCheck report unavailable: unverified']
    if rc['rugged']:
        f.append('RugCheck marks it as rugged')
    if rc['mint_authority']:
        f.append('creator can still mint more tokens')
    if rc['freeze_authority']:
        f.append('creator can freeze wallets (you might not be able to sell)')
    if rc['top10_pct'] > CFG['max_top10_pct']:
        f.append(f"top 10 wallets hold {rc['top10_pct']:.0f}% of supply")
    if rc['insider_pct'] > CFG['max_insider_pct']:
        f.append(f"insider wallets hold {rc['insider_pct']:.0f}%")
    if rc['insider_net_pct'] > CFG['max_network_pct']:
        f.append(f"{rc['insider_networks']} linked wallet groups hold {rc['insider_net_pct']:.0f}% "
                 f"(likely bundled launch)")
    if rc['creator_pct'] > CFG['max_creator_pct']:
        f.append(f"creator still holds {rc['creator_pct']:.1f}%")
    if rc['creator_tokens'] >= 5:
        f.append(f"creator has launched {rc['creator_tokens']} other tokens (serial launcher)")
    for d in rc['danger']:
        f.append(f'RugCheck danger: {d}')
    return f


# ---------------------------------------------------------------- 4. score
def clamp(x, lo=0.0, hi=1.0):
    return max(lo, min(hi, x))


def score(m, hist, rc, meta, buzz):
    """0-100. Rewards momentum that is building, not momentum that already happened."""
    pts, why, worry = 0.0, [], []

    # buy pressure (20): more buyers than sellers, now and over the hour
    bp_h1 = m['buys_h1'] / max(1, m['buys_h1'] + m['sells_h1'])
    bp_m5 = m['buys_m5'] / max(1, m['buys_m5'] + m['sells_m5'])
    pts += 20 * clamp((0.55 * bp_h1 + 0.45 * bp_m5 - 0.45) / 0.25)
    if bp_m5 >= 0.6:
        why.append(f"{bp_m5:.0%} of trades in the last 5 min are buys")
    if bp_m5 < 0.45:
        worry.append(f"sellers outnumber buyers right now ({bp_m5:.0%} buys in 5 min)")

    # volume acceleration (20): last 5 min running hotter than the hour's average
    rate_m5, rate_h1 = m['vol_m5'] * 12, m['vol_h1']
    accel = rate_m5 / rate_h1 if rate_h1 > 0 else 0
    pts += 20 * clamp((accel - 0.8) / 1.2)
    if accel >= 1.5:
        why.append(f"volume is speeding up ({accel:.1f}x the hourly pace)")
    elif accel < 0.5 and m['age_h'] > 1:
        worry.append('volume is fading')

    # market-cap growth between runs (20)
    if hist and hist.get('first_mcap'):
        g_first = m['mcap'] / hist['first_mcap'] - 1
        g_last = m['mcap'] / hist['last_mcap'] - 1 if hist.get('last_mcap') else 0
        pts += 12 * clamp(g_first / 1.5) + 8 * clamp(g_last / 0.3)
        if g_first > 0.5:
            why.append(f"market cap up {g_first:+.0%} since the radar first saw it")
        if g_last < -0.2:
            worry.append(f"down {g_last:.0%} since the last scan")
    else:
        pts += 6 * clamp(m['chg_h1'] / 100)  # first sighting: lean on the 1h change, lightly

    # holder growth between runs (10), from RugCheck
    if rc and hist and hist.get('holders'):
        hg = rc['holders'] / max(1, hist['holders']) - 1
        pts += 10 * clamp(hg / 0.5)
        if hg > 0.25:
            why.append(f"holders up {hg:+.0%} ({hist['holders']} to {rc['holders']})")
    elif rc:
        pts += 10 * clamp((rc['holders'] - 150) / 850)

    # sweet-spot size (10): room to grow but past the first-minute noise
    mc = m['mcap']
    pts += 10 * (1.0 if 30_000 <= mc <= 400_000 else 0.6 if mc <= 1_500_000 else 0.3)

    # real socials (10)
    links = {l['type'] for l in meta.get('links', [])} | set(m['socials'])
    soc = ('twitter' in links) + ('telegram' in links) + (m['websites'] > 0 or 'website' in links)
    pts += 10 * soc / 3
    if 'twitter' not in links:
        worry.append('no X account linked')

    # X buzz (10), only when the laptop reader has fresh data
    if buzz:
        pts += 10 * clamp(buzz.get('score', 0) / 100)
        if buzz.get('score', 0) >= 60:
            why.append(f"X buzz rising ({buzz.get('posts_1h', '?')} posts in the last hour)")

    # paid promotion is not a signal; heavy boosting often comes before a dump
    if meta.get('boost', 0) >= 100:
        pts -= 5
        worry.append(f"heavily paid-promoted ({meta['boost']} boosts): often comes before a dump")

    if rc and rc['insider_networks'] >= 5:
        worry.append(f"{rc['insider_networks']} linked insider wallet groups hold {rc['insider_net_pct']:.0f}%")
    if m['liq'] is None:
        worry.append('still on the pump.fun bonding curve (no open pool yet)')

    return round(clamp(pts, 0, 100)), why, worry


# ---------------------------------------------------------------- 5. paper trading
def paper_update(paper, live, picks):
    t = now_ms()
    closed_now = []
    for pos in paper['open'][:]:
        m = live.get(pos['address'])
        if m is None or m['price'] <= 0:
            if (t - pos['opened']) / 3_600_000 > CFG['max_hold_hours'] + 6:
                pos.update(exit_price=0, exit_reason='no price data (likely dead)')
            else:
                continue
        else:
            ret = m['price'] / pos['entry_price'] - 1
            pos['last_price'], pos['peak'] = m['price'], max(pos.get('peak', 0), ret)
            reason = ('take profit' if ret >= CFG['take_profit'] else
                      'stop loss' if ret <= CFG['stop_loss'] else
                      'time limit' if (t - pos['opened']) / 3_600_000 >= CFG['max_hold_hours'] else None)
            if not reason:
                continue
            pos.update(exit_price=m['price'], exit_reason=reason)
        gross = pos['exit_price'] / pos['entry_price'] - 1 if pos['entry_price'] else -1
        pos['closed'] = t
        pos['return_pct'] = round(100 * (gross - CFG['round_trip_cost']), 1)
        pos['pnl_usd'] = round(pos['stake'] * (gross - CFG['round_trip_cost']), 2)
        paper['open'].remove(pos)
        paper['closed'].append(pos)
        closed_now.append(pos)

    held = {p['address'] for p in paper['open']}
    for c in picks:
        if len(paper['open']) >= CFG['max_open']:
            break
        if c['address'] in held or c['address'] in paper.get('ever', []):
            continue
        paper['open'].append({'address': c['address'], 'symbol': c['symbol'], 'url': c['url'],
                              'opened': t, 'entry_price': c['price'], 'entry_mcap': c['mcap'],
                              'entry_score': c['score'], 'stake': CFG['stake_usd'], 'peak': 0})
        paper.setdefault('ever', []).append(c['address'])

    done = paper['closed']
    wins = [p for p in done if p['pnl_usd'] > 0]
    paper['summary'] = {
        'trades': len(done), 'open': len(paper['open']),
        'win_rate': round(100 * len(wins) / len(done), 1) if done else None,
        'total_pnl_usd': round(sum(p['pnl_usd'] for p in done), 2),
        'avg_return_pct': round(sum(p['return_pct'] for p in done) / len(done), 1) if done else None,
        'best_pct': max((p['return_pct'] for p in done), default=None),
        'worst_pct': min((p['return_pct'] for p in done), default=None),
        'note': 'Prices are sampled every ~15 min, so real exits would differ; '
                f"{int(CFG['round_trip_cost'] * 100)}% fees and slippage charged per trade.",
    }
    return closed_now


# ---------------------------------------------------------------- main
def run(fetch=get_json):
    t0 = now_ms()
    state = load('state.json', {'watch': {}})
    paper = load('paper.json', {'open': [], 'closed': [], 'ever': []})
    buzz_all = load('buzz.json', {'updated': 0, 'coins': {}})
    buzz_fresh = (t0 - buzz_all.get('updated', 0)) < 2 * 3_600_000

    found = discover(fetch)
    # forget coins older than the watch window
    cutoff = t0 - CFG['watch_hours'] * 3_600_000
    state['watch'] = {a: h for a, h in state['watch'].items() if h.get('first_seen', 0) >= cutoff}
    for a, meta in found.items():
        state['watch'].setdefault(a, {'first_seen': t0})
    addrs = sorted(state['watch'], key=lambda a: -state['watch'][a].get('last_score', 0))[:CFG['max_watch']]
    for a in set(found) - set(addrs):
        addrs.append(a)
    for p in paper['open']:  # always price open paper trades
        if p['address'] not in addrs:
            addrs.append(p['address'])

    pairs = pairs_for(addrs, fetch)
    live = {a: measure(p) for a, p in pairs.items()}

    rows, rugchecks = [], 0
    # check the most active coins first so the RugCheck budget goes where it matters
    order = sorted(live, key=lambda a: -(live[a]['vol_h1']))
    for a in order:
        m = live[a]
        hist = state['watch'].setdefault(a, {'first_seen': t0})
        meta = found.get(a) or hist.get('meta') or {'links': [], 'boost': 0, 'desc': '', 'sources': set()}
        meta_store = {k: (sorted(v) if isinstance(v, set) else v) for k, v in meta.items()}
        flags = basic_flags(m)
        rc = None
        if not flags and rugchecks < CFG['max_rugchecks']:
            rc = rug_report(a, fetch)
            rugchecks += 1
            time.sleep(1.0)
            flags += rug_flags(rc)
        elif not flags:
            flags.append('not safety-checked this run (RugCheck budget used)')
        buzz = (buzz_all.get('coins') or {}).get(a) if buzz_fresh else None
        sc, why, worry = score(m, hist, rc, meta, buzz) if not flags else (0, [], [])
        verdict = 'SKIP' if flags else ('WATCH' if sc >= CFG['pick_score'] else 'WAIT')
        rows.append({
            'address': a, 'symbol': m['symbol'], 'name': m['name'], 'url': m['url'],
            'dex': m['dex'], 'quote': m['quote'], 'price': m['price'], 'mcap': round(m['mcap']),
            'liq': None if m['liq'] is None else round(m['liq']), 'age_h': round(m['age_h'], 1),
            'chg_m5': m['chg_m5'], 'chg_h1': m['chg_h1'], 'chg_h24': m['chg_h24'],
            'vol_h1': round(m['vol_h1']), 'buys_h1': m['buys_h1'], 'sells_h1': m['sells_h1'],
            'holders': rc['holders'] if rc else None,
            'top10_pct': rc['top10_pct'] if rc else None,
            'score': sc, 'verdict': verdict, 'reasons': why, 'concerns': worry, 'red_flags': flags,
            'links': meta.get('links', []), 'boost': meta.get('boost', 0),
            'sources': sorted(meta.get('sources', [])) if meta.get('sources') else [],
            'first_seen': hist['first_seen'],
            'buzz': buzz,
        })
        # history for next run
        hist.setdefault('first_mcap', m['mcap'])
        hist['last_mcap'] = m['mcap']
        hist['last_score'] = sc
        hist['meta'] = meta_store
        if rc:
            hist['holders'] = rc['holders']

    rows.sort(key=lambda r: (r['verdict'] != 'WATCH', r['verdict'] != 'WAIT', -r['score'], -r['vol_h1']))
    picks = [r for r in rows if r['verdict'] == 'WATCH']
    closed_now = paper_update(paper, live, picks)

    latest = {
        'updated': iso(t0), 'updated_ms': t0,
        'took_s': round((now_ms() - t0) / 1000, 1),
        'counts': {'scanned': len(rows), 'watch': len(picks),
                   'wait': sum(r['verdict'] == 'WAIT' for r in rows),
                   'skip': sum(r['verdict'] == 'SKIP' for r in rows),
                   'rugchecks': rugchecks},
        'buzz_fresh': buzz_fresh,
        'settings': CFG,
        'coins': rows[:120],
        'closed_this_run': closed_now,
    }
    save('latest.json', latest)
    save('paper.json', paper)
    save('state.json', state)
    # the laptop X reader only needs the coins worth checking
    save('candidates.json', {'updated': iso(t0), 'coins': [
        {'address': r['address'], 'symbol': r['symbol'], 'name': r['name'],
         'x': [l['url'] for l in r['links'] if l.get('type') == 'twitter']}
        for r in rows if r['verdict'] != 'SKIP'][:25]})
    print(f"scanned {len(rows)} | watch {len(picks)} | wait {latest['counts']['wait']} | "
          f"skip {latest['counts']['skip']} | rugchecks {rugchecks} | "
          f"paper open {len(paper['open'])} closed {len(paper['closed'])} | {latest['took_s']}s")
    return latest


if __name__ == '__main__':
    run()
