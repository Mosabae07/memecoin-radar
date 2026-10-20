"""Offline test: real DexScreener rows captured 2026-10-20, fake RugCheck answers.
Run: python3 -m pytest -q tests   (or python3 tests/test_scan.py)"""
import json
import os
import shutil
import sys
import tempfile
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'radar'))
import scan  # noqa: E402

NOW = int(time.time() * 1000)
H = 3_600_000
# [address, symbol, dex, quote, price, b_m5, s_m5, b_h1, s_h1, b_h24, s_h24,
#  vol_m5, vol_h1, vol_h24, chg_m5, chg_h1, chg_h24, liq, mcap, age_hours, boost, socials]
ROWS = [
    ['MONEYBIZpump', 'MONEYBIZ', 'pumpswap', 'SOL', 0.0008953, 460, 339, 6306, 3153, 6306, 3153, 40193, 838981, 838981, 5.31, 1223, 1223, 82215, 888990, 0.8, 0, 'twitter'],
    ['WISPpump', 'WiSP', 'pumpswap', 'SOL', 0.00005961, 155, 107, 666, 492, 666, 492, 11955, 45959, 45959, 44.68, 38.71, 38.71, 19273, 59618, 0.3, 30, 'twitter|telegram'],
    ['PSTRpump', 'PSTR', 'pumpfun', 'SOL', 0.00002854, 191, 132, 1426, 1313, 1426, 1313, 12518, 91389, 91389, 2.03, 789, 789, None, 28547, 0.2, 0, 'twitter'],
    ['LAURApump', 'Laura', 'pumpswap', 'SOL', 0.0001029, 162, 101, 1704, 933, 1704, 933, 21066, 188618, 188618, -35.61, 129, 129, 26525, 98252, 0.6, 0, 'twitter'],
    ['TROADpump', 'TROAD', 'pumpswap', 'SOL', 0.00000226, 0, 0, 0, 0, 6228, 5960, 0, 0, 610045, 0, 0, -94.8, 2440, 2177, 9.5, 50, 'twitter'],
    ['TWYNEpump', 'Twyne', 'pumpswap', 'SOL', 0.000002553, 0, 0, 0, 3, 12276, 15197, 0, 7, 1408973, 0, -0.83, -94.1, 2861, 2437, 11, 100, 'twitter'],
    ['GTA6pump', 'GTA 6 Coin', 'raydium', 'SOL', 0.001103, 0, 1, 14, 3, 181, 130, 21, 1551, 20146, -0.19, -0.97, 3.48, 152011, 1102238, 6380, 10, 'twitter|telegram'],
    ['FRENpump', 'FREN', 'pumpfun', 'SOL', 0.00001717, 328, 203, 328, 203, 328, 203, 33994, 33994, 33994, 474, 474, 474, None, 17172, 0.05, 0, 'twitter'],
    ['MINTpump', 'MINTY', 'pumpswap', 'SOL', 0.0001, 200, 100, 1500, 900, 1500, 900, 15000, 120000, 120000, 10, 80, 80, 30000, 150000, 1.0, 0, 'twitter'],
    ['WHALEpump', 'WHALE', 'pumpswap', 'SOL', 0.0002, 150, 90, 1200, 800, 1200, 800, 9000, 90000, 90000, 5, 60, 60, 25000, 200000, 2.0, 0, 'twitter'],
    ['THINpump', 'THIN', 'pumpswap', 'SOL', 0.0003, 100, 80, 900, 700, 900, 700, 5000, 50000, 50000, 2, 30, 30, 4000, 300000, 3.0, 0, 'twitter'],
]


def pair(r, price_mult=1.0, buys_mult=1.0):
    (a, sym, dex, q, price, bm5, sm5, bh1, sh1, b24, s24, vm5, vh1, v24, cm5, ch1, c24,
     liq, mcap, age, boost, socials) = r
    return {
        'chainId': 'solana', 'dexId': dex, 'url': f'https://dexscreener.com/solana/{a.lower()}',
        'pairAddress': 'P' + a, 'baseToken': {'address': a, 'symbol': sym, 'name': sym},
        'quoteToken': {'symbol': q}, 'priceUsd': str(price * price_mult),
        'txns': {'m5': {'buys': int(bm5 * buys_mult), 'sells': sm5}, 'h1': {'buys': bh1, 'sells': sh1},
                 'h24': {'buys': b24, 'sells': s24}},
        'volume': {'m5': vm5, 'h1': vh1, 'h24': v24},
        'priceChange': {'m5': cm5, 'h1': ch1, 'h24': c24},
        'liquidity': None if liq is None else {'usd': liq},
        'marketCap': mcap * price_mult, 'fdv': mcap * price_mult,
        'pairCreatedAt': NOW - int(age * H),
        'info': {'socials': [{'type': s, 'url': f'https://x.com/{sym}'} for s in socials.split('|') if s],
                 'websites': [{'url': 'https://example.com'}]},
    }


def rug(addr, holders=900):
    base = {'mintAuthority': None, 'freezeAuthority': None, 'rugged': False, 'totalHolders': holders,
            'topHolders': [{'owner': f'w{i}', 'address': f'h{i}', 'pct': 2.0, 'insider': False} for i in range(10)],
            'insiderNetworks': [], 'graphInsidersDetected': 0, 'creatorBalance': 0,
            'token': {'supply': 1_000_000_000}, 'creatorTokens': [], 'risks': [], 'markets': [],
            'knownAccounts': {}}
    if addr == 'MINTpump':
        base['mintAuthority'] = 'Creator111'
    if addr == 'WHALEpump':
        base['topHolders'][0]['pct'] = 40.0
    if addr == 'MONEYBIZpump':   # real report: 10 linked groups holding 34.4%, top 10 only 3%
        base['insiderNetworks'] = [{'currentHolding': 34_400_000}] * 10
    if addr == 'LAURApump':      # real report: 1 group holding 2.5%
        base['insiderNetworks'] = [{'currentHolding': 25_000_000}]
    return base


class FakeAPI:
    def __init__(self):
        self.price_mult, self.buys_mult, self.holders = 1.0, 1.0, 900
        self.calls = []

    def __call__(self, url):
        self.calls.append(url)
        if '/token-profiles/latest' in url:
            return [{'chainId': 'solana', 'tokenAddress': r[0], 'links': [{'type': 'twitter', 'url': 'https://x.com/' + r[1]}],
                     'description': r[1]} for r in ROWS] + [{'chainId': 'bsc', 'tokenAddress': '0xabc'}]
        if '/token-boosts/' in url:
            return [{'chainId': 'solana', 'tokenAddress': r[0], 'totalAmount': r[20]} for r in ROWS if r[20]]
        if '/community-takeovers/' in url:
            return []
        if '/tokens/v1/solana/' in url:
            want = url.rsplit('/', 1)[1].split(',')
            return [pair(r, self.price_mult, self.buys_mult) for r in ROWS if r[0] in want]
        if 'rugcheck' in url:
            return rug(url.split('/tokens/')[1].split('/')[0], self.holders)
        raise AssertionError('unexpected url ' + url)


def run_twice():
    tmp = tempfile.mkdtemp()
    scan.DATA = tmp
    scan.time.sleep = lambda s: None
    api = FakeAPI()
    first = scan.run(api)
    api.price_mult, api.buys_mult, api.holders = 1.6, 1.5, 1500   # second scan: everything moved up
    second = scan.run(api)
    api.price_mult = 2.3                                           # third: still climbing
    third = scan.run(api)
    api.price_mult = 3.6                                           # fourth: entries from scan 2 double
    scan.run(api)
    paper = json.load(open(os.path.join(tmp, 'paper.json')))
    shutil.rmtree(tmp)
    return first, second, third, paper, api


def by_sym(latest):
    return {c['symbol']: c for c in latest['coins']}


def test_scanner():
    first, second, third, paper, api = run_twice()
    c1 = by_sym(first)

    # dumped, paid-boosted coins are thrown out with a reason
    assert c1['TROAD']['verdict'] == 'SKIP' and any('dumped' in f for f in c1['TROAD']['red_flags'])
    assert c1['Twyne']['verdict'] == 'SKIP'
    # old coin is not "early"
    assert any('days old' in f for f in c1['GTA 6 Coin']['red_flags'])
    # dumped coins under the size floor are skipped on both counts
    assert any('below' in f for f in c1['TROAD']['red_flags'])
    # a minutes-old coin above the floor is allowed through to be watched
    assert c1['FREN']['verdict'] == 'WAIT'
    # scam markers from RugCheck
    assert any('mint' in f for f in c1['MINTY']['red_flags'])
    assert any('top 10 wallets' in f for f in c1['WHALE']['red_flags'])
    # thin liquidity
    assert any('liquidity' in f for f in c1['THIN']['red_flags'])
    # other chains ignored
    assert all(c['address'] != '0xabc' for c in first['coins'])
    # survivors get a score and reasons
    for s in ('WiSP', 'PSTR', 'Laura'):
        assert c1[s]['verdict'] in ('WATCH', 'WAIT'), (s, c1[s]['red_flags'])
        assert 0 < c1[s]['score'] <= 100
    # hidden bundling: spread across many wallets, caught by linked-group total
    assert c1['MONEYBIZ']['verdict'] == 'SKIP'
    assert any('linked wallet groups hold 34%' in f for f in c1['MONEYBIZ']['red_flags'])
    assert any('paid-promoted' in w for w in c1['WiSP']['concerns']) is False  # 30 boosts: below the bar
    assert any('bonding curve' in w for w in c1['PSTR']['concerns'])

    # second scan: growth since first sighting raises scores
    c2 = by_sym(second)
    assert c2['WiSP']['score'] > c1['WiSP']['score']
    assert any('since the radar first saw it' in r for r in c2['WiSP']['reasons'])

    # paper trading opened on WATCH picks, closed on take-profit with costs charged
    s = paper['summary']
    assert s['trades'] >= 1, 'expected a closed paper trade'
    # first sighting alone never triggers a pick: it needs confirmation on a later scan
    assert first['counts']['watch'] == 0
    for p in paper['closed']:
        assert p['exit_reason'] in ('take profit', 'stop loss', 'time limit', 'no price data (likely dead)')
        if p['exit_reason'] == 'take profit':
            assert p['return_pct'] > 90
    # RugCheck budget respected
    assert first['counts']['rugchecks'] <= scan.CFG['max_rugchecks']
    print('first :', {k: (v['verdict'], v['score']) for k, v in c1.items()})
    print('second:', {k: (v['verdict'], v['score']) for k, v in c2.items() if v['verdict'] != 'SKIP'})
    print('paper :', s)
    print('closed:', [(p['symbol'], p['exit_reason'], p['return_pct']) for p in paper['closed']])


def test_stop_loss():
    tmp = tempfile.mkdtemp()
    scan.DATA = tmp
    scan.time.sleep = lambda s: None
    api = FakeAPI()
    scan.run(api)
    api.price_mult, api.buys_mult, api.holders = 1.6, 1.5, 1500
    scan.run(api)                       # picks opened here
    api.price_mult = 0.9                # -44% from entry: below the -35% stop
    scan.run(api)
    paper = json.load(open(os.path.join(tmp, 'paper.json')))
    shutil.rmtree(tmp)
    assert paper['closed'] and all(p['exit_reason'] == 'stop loss' for p in paper['closed'])
    assert all(p['return_pct'] < -35 for p in paper['closed'])
    assert paper['summary']['win_rate'] == 0
    print('stop  :', [(p['symbol'], p['return_pct']) for p in paper['closed']])


if __name__ == '__main__':
    test_scanner()
    test_stop_loss()
    print('OK')
