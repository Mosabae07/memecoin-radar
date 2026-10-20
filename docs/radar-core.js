// Memecoin Radar: the rules, shared by the 15-minute GitHub scanner (Node) and
// the live session mode on the dashboard (browser). One file, so both always agree.
//
// It never buys anything. Scores are signals, not predictions, and most new meme
// coins still go to zero. Free data only: DexScreener and RugCheck need no key.

export const DEX = 'https://api.dexscreener.com';
export const RUG = 'https://api.rugcheck.xyz/v1';

export const CFG = {
  chain: 'solana',
  watch_hours: 24,            // keep re-checking a coin this long after first sight
  max_watch: 150,             // cap on coins re-checked per scan
  max_rugchecks: 12,          // full RugCheck reports per scan (be polite)
  rug_cache_min: 0,           // reuse a RugCheck report this many minutes (live mode sets this)
  rug_gap_ms: 1000,           // pause between RugCheck calls
  // hard filters (the Skeptic's automatic "skip")
  min_mcap: 15_000,
  max_mcap: 5_000_000,
  min_liq_usd: 8_000,         // graduated pools only; bonding-curve coins report none
  min_liq_ratio: 0.04,        // liquidity / market cap
  min_txns_h1: 60,
  max_drop_h24: -60,          // % from 24h start; below this it already dumped
  max_age_days: 7,
  max_top10_pct: 35,          // top 10 holders excluding pools and known accounts
  max_insider_pct: 15,
  max_creator_pct: 5,
  max_network_pct: 20,        // linked insider wallet groups, combined
  // paper trading
  pick_score: 70,
  stake_usd: 100,
  take_profit: 1.0,           // +100%
  stop_loss: -0.35,           // -35%
  max_hold_hours: 24,
  round_trip_cost: 0.04,      // fees + slippage on thin coins, charged on close
  max_open: 10,
  // exit rule B (compared side by side with the rules above)
  ladder_trail: 0.30,         // after selling half at take-profit, exit the rest 30% below its peak
  // learning
  track_outcomes: true,       // record each coin's numbers and its price 1h/6h/24h later
  max_tracked: 250,
  theme_min_coins: 3,         // a word shared by this many active coins is a "hot theme"
};

const HOUR = 3_600_000;
const num = x => { const n = parseFloat(x); return Number.isFinite(n) ? n : 0; };
const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const fmtUsd = v => '$' + Math.round(v).toLocaleString('en-US');
export const iso = ms => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

// ------------------------------------------------------------- 1. discover
export async function discover(get, cfg = CFG) {
  const found = {};
  const feeds = [['/token-profiles/latest/v1', 'new profile'],
                 ['/community-takeovers/latest/v1', 'community takeover'],
                 ['/token-boosts/latest/v1', 'paid boost'],
                 ['/token-boosts/top/v1', 'paid boost']];
  for (const [path, why] of feeds) {
    const rows = (await get(DEX + path)) || [];
    for (const r of rows) {
      if (r.chainId !== cfg.chain || !r.tokenAddress) continue;
      const f = found[r.tokenAddress] ??= { sources: [], links: [], boost: 0, desc: '' };
      if (!f.sources.includes(why)) f.sources.push(why);
      f.boost = Math.max(f.boost, r.totalAmount || r.amount || 0);
      if (r.links?.length && !f.links.length)
        f.links = r.links.filter(l => l.url).map(l => ({ type: l.type || l.label || 'website', url: l.url }));
      if (r.description && !f.desc) f.desc = r.description.slice(0, 240);
    }
  }
  return found;
}

export async function pairsFor(addrs, get, sleep, cfg = CFG) {
  const best = {};
  for (let i = 0; i < addrs.length; i += 30) {
    const rows = (await get(`${DEX}/tokens/v1/${cfg.chain}/${addrs.slice(i, i + 30).join(',')}`)) || [];
    for (const p of rows) {
      const a = p.baseToken?.address;
      if (!a) continue;
      const key = [p.liquidity?.usd || 0, p.volume?.h24 || 0];
      const cur = best[a];
      if (!cur || key[0] > cur.key[0] || (key[0] === cur.key[0] && key[1] > cur.key[1])) best[a] = { key, p };
    }
    await sleep(300);
  }
  return Object.fromEntries(Object.entries(best).map(([a, v]) => [a, v.p]));
}

// ------------------------------------------------------------- 2. measure
export function measure(p, now) {
  const tx = p.txns || {}, vol = p.volume || {}, ch = p.priceChange || {};
  const b = w => tx[w]?.buys || 0, s = w => tx[w]?.sells || 0;
  const liq = p.liquidity?.usd;
  return {
    symbol: p.baseToken?.symbol ?? '?', name: p.baseToken?.name ?? '',
    dex: p.dexId ?? '', quote: p.quoteToken?.symbol ?? '', url: p.url ?? '',
    price: num(p.priceUsd), mcap: num(p.marketCap || p.fdv),
    liq: liq == null ? null : num(liq),
    buys_m5: b('m5'), sells_m5: s('m5'), buys_h1: b('h1'), sells_h1: s('h1'),
    buys_h24: b('h24'), sells_h24: s('h24'),
    vol_m5: num(vol.m5), vol_h1: num(vol.h1), vol_h24: num(vol.h24),
    chg_m5: num(ch.m5), chg_h1: num(ch.h1), chg_h24: num(ch.h24),
    age_h: Math.max(0, (now - (p.pairCreatedAt || now)) / HOUR), now,
    socials: [...new Set((p.info?.socials || []).map(x => x.type).filter(Boolean))].sort(),
    websites: (p.info?.websites || []).length,
  };
}

// ------------------------------------------------------------- 3. skeptic
export function basicFlags(m, cfg = CFG) {
  const f = [];
  if (m.price <= 0 || m.mcap <= 0) f.push('no usable price data');
  if (m.mcap < cfg.min_mcap) f.push(`market cap ${fmtUsd(m.mcap)} is below ${fmtUsd(cfg.min_mcap)}: too early to tell a launch from a dud`);
  if (m.mcap > cfg.max_mcap) f.push(`market cap ${fmtUsd(m.mcap)}: no longer early`);
  if (m.chg_h24 <= cfg.max_drop_h24) f.push(`already dumped: down ${Math.abs(m.chg_h24).toFixed(0)}% in 24h`);
  const t = m.buys_h1 + m.sells_h1;
  if (t < cfg.min_txns_h1) f.push(`only ${t} trades in the last hour: no real activity`);
  if (m.age_h > cfg.max_age_days * 24) f.push(`${(m.age_h / 24).toFixed(0)} days old: not early`);
  if (m.liq != null) {
    if (m.liq < cfg.min_liq_usd) f.push(`liquidity ${fmtUsd(m.liq)} is too thin to exit`);
    else if (m.mcap && m.liq / m.mcap < cfg.min_liq_ratio)
      f.push(`liquidity is only ${(100 * m.liq / m.mcap).toFixed(1)}% of market cap: price is easy to crash`);
  }
  return f;
}

export async function rugReport(addr, get) {
  const r = await get(`${RUG}/tokens/${addr}/report`);
  if (!r) return null;
  // skip pools/AMMs when counting whales, but keep the creator's wallet in
  const known = new Set(Object.entries(r.knownAccounts || {}).filter(([, v]) => v?.type !== 'CREATOR').map(([k]) => k));
  const pools = new Set((r.markets || []).flatMap(m => [m.pubkey, m.liquidityA, m.liquidityB]).filter(Boolean));
  const holders = (r.topHolders || []).filter(h => !known.has(h.owner) && !pools.has(h.address) && !pools.has(h.owner));
  const top10 = holders.slice(0, 10).reduce((s, h) => s + num(h.pct), 0);
  const insider = (r.topHolders || []).filter(h => h.insider).reduce((s, h) => s + num(h.pct), 0);
  const supply = num(r.token?.supply);
  const creatorPct = supply ? 100 * num(r.creatorBalance) / supply : 0;
  // wallets RugCheck links together (funded from the same source): how much they still hold
  const netPct = supply ? 100 * (r.insiderNetworks || []).reduce((s, n) => s + num(n.currentHolding || n.tokenAmount), 0) / supply : 0;
  const r1 = x => Math.round(x * 10) / 10;
  return {
    mint_authority: !!r.mintAuthority, freeze_authority: !!r.freezeAuthority, rugged: !!r.rugged,
    holders: Math.trunc(num(r.totalHolders)),
    top10_pct: r1(top10), insider_pct: r1(insider),
    insider_networks: (r.insiderNetworks || []).length, insider_net_pct: r1(netPct),
    creator_pct: Math.round(creatorPct * 100) / 100,
    creator_tokens: (r.creatorTokens || []).length,
    danger: (r.risks || []).filter(x => x.level === 'danger').map(x => x.name),
    warn: (r.risks || []).filter(x => x.level === 'warn').map(x => x.name),
  };
}

export function rugFlags(rc, cfg = CFG) {
  if (!rc) return ['RugCheck report unavailable: unverified'];
  const f = [];
  if (rc.rugged) f.push('RugCheck marks it as rugged');
  if (rc.mint_authority) f.push('creator can still mint more tokens');
  if (rc.freeze_authority) f.push('creator can freeze wallets (you might not be able to sell)');
  if (rc.top10_pct > cfg.max_top10_pct) f.push(`top 10 wallets hold ${rc.top10_pct.toFixed(0)}% of supply`);
  if (rc.insider_pct > cfg.max_insider_pct) f.push(`insider wallets hold ${rc.insider_pct.toFixed(0)}%`);
  if (rc.insider_net_pct > cfg.max_network_pct)
    f.push(`${rc.insider_networks} linked wallet groups hold ${rc.insider_net_pct.toFixed(0)}% (likely bundled launch)`);
  if (rc.creator_pct > cfg.max_creator_pct) f.push(`creator still holds ${rc.creator_pct.toFixed(1)}%`);
  if (rc.creator_tokens >= 5) f.push(`creator has launched ${rc.creator_tokens} other tokens (serial launcher)`);
  for (const d of rc.danger) f.push(`RugCheck danger: ${d}`);
  return f;
}

// ------------------------------------------------------------- 4. score
const pc = x => `${x >= 0 ? '+' : ''}${Math.round(x * 100)}%`;

export function score(m, hist, rc, meta, buzz) {
  let pts = 0;
  const why = [], worry = [];

  // buy pressure (20): more buyers than sellers, now and over the hour
  const bpH1 = m.buys_h1 / Math.max(1, m.buys_h1 + m.sells_h1);
  const bpM5 = m.buys_m5 / Math.max(1, m.buys_m5 + m.sells_m5);
  pts += 20 * clamp((0.55 * bpH1 + 0.45 * bpM5 - 0.45) / 0.25);
  if (bpM5 >= 0.6) why.push(`${Math.round(bpM5 * 100)}% of trades in the last 5 min are buys`);
  if (bpM5 < 0.45) worry.push(`sellers outnumber buyers right now (${Math.round(bpM5 * 100)}% buys in 5 min)`);

  // volume acceleration (20): last 5 min running hotter than the hour's average
  const accel = m.vol_h1 > 0 ? (m.vol_m5 * 12) / m.vol_h1 : 0;
  pts += 20 * clamp((accel - 0.8) / 1.2);
  if (accel >= 1.5) why.push(`volume is speeding up (${accel.toFixed(1)}x the hourly pace)`);
  else if (accel < 0.5 && m.age_h > 1) worry.push('volume is fading');

  // market-cap growth between scans (20)
  if (hist?.first_mcap) {
    const gFirst = m.mcap / hist.first_mcap - 1;
    const gLast = hist.last_mcap ? m.mcap / hist.last_mcap - 1 : 0;
    pts += 12 * clamp(gFirst / 1.5) + 8 * clamp(gLast / 0.3);
    if (gFirst > 0.5) why.push(`market cap up ${pc(gFirst)} since the radar first saw it`);
    if (gLast < -0.2) worry.push(`down ${pc(gLast)} since the last scan`);
  } else {
    pts += 6 * clamp(m.chg_h1 / 100); // first sighting: lean on the 1h change, lightly
  }

  // holder growth between scans (10), from RugCheck
  if (rc && hist?.holders) {
    const hg = rc.holders / Math.max(1, hist.holders) - 1;
    pts += 10 * clamp(hg / 0.5);
    if (hg > 0.25) why.push(`holders up ${pc(hg)} (${hist.holders} to ${rc.holders})`);
  } else if (rc) {
    pts += 10 * clamp((rc.holders - 150) / 850);
  }

  // sweet-spot size (10)
  const mc = m.mcap;
  pts += 10 * (mc >= 30_000 && mc <= 400_000 ? 1 : mc <= 1_500_000 ? 0.6 : 0.3);

  // real socials (10)
  const links = new Set([...(meta.links || []).map(l => l.type), ...m.socials]);
  const soc = +links.has('twitter') + +links.has('telegram') + +(m.websites > 0 || links.has('website'));
  pts += 10 * soc / 3;
  if (!links.has('twitter')) worry.push('no X account linked');

  // X buzz (10), only when the laptop reader has fresh data
  if (buzz) {
    pts += 10 * clamp((buzz.score || 0) / 100);
    if ((buzz.score || 0) >= 60) why.push(`X buzz rising (${buzz.posts_1h ?? '?'} posts in the last hour)`);
  }

  // paid promotion is not a signal; heavy boosting often comes before a dump
  if ((meta.boost || 0) >= 100) {
    pts -= 5;
    worry.push(`heavily paid-promoted (${meta.boost} boosts): often comes before a dump`);
  }
  if (rc && rc.insider_networks >= 5) worry.push(`${rc.insider_networks} linked insider wallet groups hold ${rc.insider_net_pct.toFixed(0)}%`);
  if (m.liq == null) worry.push('still on the pump.fun bonding curve (no open pool yet)');
  // from the live pump.fun feed (live mode only)
  if (meta.graduated_at && m.now - meta.graduated_at < 2 * HOUR)
    why.push(`graduated from pump.fun ${Math.max(1, Math.round((m.now - meta.graduated_at) / 60000))} min ago (now in an open pool)`);
  if ((meta.dev_buy_pct ?? 0) >= 10) worry.push(`creator bought ${meta.dev_buy_pct.toFixed(0)}% of supply at launch`);

  return [Math.round(clamp(pts, 0, 100)), why, worry];
}

// ------------------------------------------------------------- 5. paper trading
// Exit rules. 'simple' (A): sell everything at +100%, -35% or 24h.
// 'ladder' (B): sell half at +100%, then sell the rest once it falls 30% from its peak (or -35% / 24h).
export function paperUpdate(paper, live, picks, now, cfg = CFG, strategy = 'simple') {
  const closedNow = [];
  for (const pos of [...paper.open]) {
    const m = live[pos.address];
    if (!m || m.price <= 0) {
      if ((now - pos.opened) / HOUR <= cfg.max_hold_hours + 6) continue;
      Object.assign(pos, { exit_price: 0, exit_reason: 'no price data (likely dead)' });
    } else {
      const ret = m.price / pos.entry_price - 1;
      pos.last_price = m.price;
      pos.peak = Math.max(pos.peak || 0, ret);
      const timeUp = (now - pos.opened) / HOUR >= cfg.max_hold_hours;
      let reason = null;
      if (strategy === 'ladder') {
        if (!pos.half_price && ret >= cfg.take_profit) { pos.half_price = m.price; pos.half_at = now; }
        const fromPeak = (1 + ret) / (1 + pos.peak) - 1;
        reason = !pos.half_price && ret <= cfg.stop_loss ? 'stop loss'
          : pos.half_price && fromPeak <= -cfg.ladder_trail ? 'trailing stop (half sold at take profit)'
          : timeUp ? (pos.half_price ? 'time limit (half sold at take profit)' : 'time limit') : null;
      } else {
        reason = ret >= cfg.take_profit ? 'take profit' : ret <= cfg.stop_loss ? 'stop loss' : timeUp ? 'time limit' : null;
      }
      if (!reason) continue;
      Object.assign(pos, { exit_price: m.price, exit_reason: reason });
    }
    const leg = px => pos.entry_price ? px / pos.entry_price - 1 : -1;
    const gross = pos.half_price ? 0.5 * leg(pos.half_price) + 0.5 * leg(pos.exit_price) : leg(pos.exit_price);
    pos.closed = now;
    pos.return_pct = Math.round(1000 * (gross - cfg.round_trip_cost)) / 10;
    pos.pnl_usd = Math.round(100 * pos.stake * (gross - cfg.round_trip_cost)) / 100;
    paper.open.splice(paper.open.indexOf(pos), 1);
    paper.closed.push(pos);
    closedNow.push(pos);
  }

  const opened = [];
  const held = new Set(paper.open.map(p => p.address));
  paper.ever ??= [];
  for (const c of picks) {
    if (paper.open.length >= cfg.max_open) break;
    if (held.has(c.address) || paper.ever.includes(c.address)) continue;
    const pos = { address: c.address, symbol: c.symbol, url: c.url, opened: now, entry_price: c.price,
                  entry_mcap: c.mcap, entry_score: c.score, stake: cfg.stake_usd, peak: 0 };
    paper.open.push(pos);
    paper.ever.push(c.address);
    opened.push(pos);
  }

  const done = paper.closed;
  const wins = done.filter(p => p.pnl_usd > 0);
  const avg = a => Math.round(10 * a.reduce((s, x) => s + x, 0) / a.length) / 10;
  paper.summary = {
    trades: done.length, open: paper.open.length,
    win_rate: done.length ? Math.round(1000 * wins.length / done.length) / 10 : null,
    total_pnl_usd: Math.round(100 * done.reduce((s, p) => s + p.pnl_usd, 0)) / 100,
    avg_return_pct: done.length ? avg(done.map(p => p.return_pct)) : null,
    best_pct: done.length ? Math.max(...done.map(p => p.return_pct)) : null,
    worst_pct: done.length ? Math.min(...done.map(p => p.return_pct)) : null,
    note: `Prices are sampled between scans, so real exits would differ; ${Math.round(cfg.round_trip_cost * 100)}% fees and slippage charged per trade.`,
  };
  return { closedNow, opened };
}

// ------------------------------------------------------------- 6. hot themes
const STOP = new Set(('the and for you your with this that are not but its all coin coins token tokens sol solana pump fun meme memes ' +
  'official real first new only just one get got will can has have from out who what when how why our was his her they them ' +
  'next big community community-driven ecosystem powered built launch launched ca contract dev team holders world www com xyz app ' +
  'season day time make made more most best everyone everything nothing someone thing things like love going go up forever ' +
  'paired pair pairs liquidity locked burned burn lp tax holder buy sell trade trading price market cap website twitter telegram join ' +
  'every until turn xitter than into about over also very much many only').split(' '));
export function themeWords(c) {
  const text = `${c.name || ''} ${c.symbol || ''} ${(c.desc || '').slice(0, 120)}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const words = text.split(/[^a-z0-9]+/).map(w => w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w)
    .filter(w => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w));
  return [...new Set(words)];
}
// a theme is a word shared by several coins that are actually trading
export function findThemes(coins, cfg = CFG) {
  const by = new Map();
  for (const c of coins) for (const w of themeWords(c)) {
    if (!by.has(w)) by.set(w, new Set());
    by.get(w).add(c.address);
  }
  return [...by].filter(([, set]) => set.size >= cfg.theme_min_coins)
    .map(([word, set]) => ({ word, coins: set.size, addrs: [...set] }))
    .sort((a, b) => b.coins - a.coins).slice(0, 10);
}

// ------------------------------------------------------------- 7. learning from outcomes
// numbers saved when a coin is first scored, so later we can see which ones predicted gains
export function features(m, hist, rc, meta, buzz, hot) {
  const r2 = x => Math.round(x * 100) / 100;
  return {
    buy_pressure_5m: r2(m.buys_m5 / Math.max(1, m.buys_m5 + m.sells_m5)),
    buy_pressure_1h: r2(m.buys_h1 / Math.max(1, m.buys_h1 + m.sells_h1)),
    volume_accel: r2(m.vol_h1 > 0 ? m.vol_m5 * 12 / m.vol_h1 : 0),
    growth_since_seen: r2(hist?.first_mcap ? m.mcap / hist.first_mcap - 1 : 0),
    change_1h: r2(m.chg_h1 / 100),
    holders: rc?.holders ?? null,
    top10_pct: rc?.top10_pct ?? null,
    insider_group_pct: rc?.insider_net_pct ?? null,
    liquidity_ratio: m.liq == null ? null : r2(m.liq / Math.max(1, m.mcap)),
    on_bonding_curve: m.liq == null ? 1 : 0,
    age_hours: r2(m.age_h),
    market_cap: Math.round(m.mcap),
    paid_boosts: meta?.boost || 0,
    x_buzz: buzz?.score ?? null,
    hot_theme: hot ? 1 : 0,
    graduated_recently: meta?.graduated_at && m.now - meta.graduated_at < 2 * HOUR ? 1 : 0,
    dev_buy_pct: meta?.dev_buy_pct ?? null,
  };
}

export function trackOutcomes(state, rows, live, now, cfg = CFG) {
  state.tracking ??= {};
  const finished = [];
  // start tracking coins the first time they pass the Skeptic and have a safety check
  for (const r of rows) {
    if (r.verdict === 'SKIP' || r.holders == null || state.tracking[r.address]) continue;
    if (Object.keys(state.tracking).length >= cfg.max_tracked) break;
    state.tracking[r.address] = { address: r.address, symbol: r.symbol, t: now, price: r.price, mcap: r.mcap,
      score: r.score, verdict: r.verdict, themes: r.themes || [], feats: r._feats, peak: 0, trough: 0 };
  }
  for (const [a, o] of Object.entries(state.tracking)) {
    const m = live[a];
    const h = (now - o.t) / HOUR;
    if (m && m.price > 0 && o.price > 0) {
      const ret = m.price / o.price - 1;
      o.peak = Math.max(o.peak, ret); o.trough = Math.min(o.trough, ret);
      for (const [k, hrs] of [['r1h', 1], ['r6h', 6], ['r24h', 24]]) if (o[k] == null && h >= hrs) o[k] = ret;
      o.last = ret; o.last_t = now;
    }
    const dead = !m && h >= 24 + 6;
    if ((o.r24h != null) || dead) {
      if (o.r24h == null) o.r24h = o.last != null ? Math.min(o.last, o.trough) : -1;
      const pc = x => x == null ? null : Math.round(x * 1000) / 10;
      finished.push({ address: a, symbol: o.symbol, t: o.t, score: o.score, verdict: o.verdict, mcap: o.mcap,
        themes: o.themes, feats: o.feats, r1h: pc(o.r1h), r6h: pc(o.r6h), r24h: pc(o.r24h), peak: pc(o.peak), trough: pc(o.trough) });
      delete state.tracking[a];
    }
  }
  return finished;
}

const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
function summarise(list) {
  const n = list.length;
  if (!n) return { n: 0 };
  const share = f => Math.round(1000 * list.filter(f).length / n) / 10;
  return { n, hit50: share(o => o.peak >= 50), hit100: share(o => o.peak >= 100),
           crash: share(o => o.trough <= -80), median_24h: Math.round(10 * median(list.map(o => o.r24h))) / 10 };
}
// what actually worked: by score band, and for each signal, coins high on it vs low on it
export function computeStats(outcomes) {
  const bands = [['80+', o => o.score >= 80], ['70-79', o => o.score >= 70 && o.score < 80], ['60-69', o => o.score >= 60 && o.score < 70],
                 ['50-59', o => o.score >= 50 && o.score < 60], ['under 50', o => o.score < 50]];
  const signals = [];
  const keys = new Set(outcomes.flatMap(o => Object.keys(o.feats || {})));
  for (const k of keys) {
    const have = outcomes.filter(o => o.feats?.[k] != null);
    if (have.length < 12) continue;
    const sorted = [...have].sort((a, b) => a.feats[k] - b.feats[k]);
    const third = Math.floor(sorted.length / 3);
    const low = summarise(sorted.slice(0, third)), high = summarise(sorted.slice(-third));
    if (sorted[0].feats[k] === sorted.at(-1).feats[k]) continue;
    signals.push({ signal: k, high, low, lift: Math.round(10 * (high.hit50 - low.hit50)) / 10 });
  }
  signals.sort((a, b) => Math.abs(b.lift) - Math.abs(a.lift));
  return { total: summarise(outcomes), bands: bands.map(([label, f]) => ({ label, ...summarise(outcomes.filter(f)) })), signals };
}

// ------------------------------------------------------------- one full scan
// ctx: { get(url) -> json|null, sleep(ms), now, state, paper, buzz, cfg, rugCache? }
// state, paper and rugCache are updated in place.
export async function runScan(ctx) {
  const cfg = { ...CFG, ...(ctx.cfg || {}) };
  const { get, sleep } = ctx;
  const t0 = ctx.now ?? Date.now();
  const startedAt = Date.now();   // real clock, for timing (t0 can be simulated in tests)
  const state = ctx.state; state.watch ??= {};
  const paper = ctx.paper; paper.open ??= []; paper.closed ??= []; paper.ever ??= [];
  const buzzAll = ctx.buzz || { updated: 0, coins: {} };
  const buzzFresh = (t0 - (buzzAll.updated || 0)) < 2 * HOUR;
  const rugCache = ctx.rugCache;

  const found = await discover(get, cfg);
  // coins found by other routes (live mode: pump.fun launches and graduations)
  for (const [a, extra] of Object.entries(ctx.extraFound || {})) {
    const f = found[a] ??= { sources: [], links: [], boost: 0, desc: '' };
    for (const src of extra.sources || []) if (!f.sources.includes(src)) f.sources.push(src);
    for (const k of ['graduated_at', 'launched_at', 'dev_buy_pct']) if (extra[k] != null) f[k] = extra[k];
    if (!f.desc && extra.desc) f.desc = extra.desc;
  }
  const cutoff = t0 - cfg.watch_hours * HOUR;
  for (const [a, h] of Object.entries(state.watch)) if ((h.first_seen || 0) < cutoff) delete state.watch[a];
  for (const a of Object.keys(found)) state.watch[a] ??= { first_seen: t0 };
  const addrs = Object.keys(state.watch).sort((a, b) => (state.watch[b].last_score || 0) - (state.watch[a].last_score || 0)).slice(0, cfg.max_watch);
  for (const a of Object.keys(found)) if (!addrs.includes(a)) addrs.push(a);
  for (const p of paper.open) if (!addrs.includes(p.address)) addrs.push(p.address);
  for (const p of ctx.paperB?.open || []) if (!addrs.includes(p.address)) addrs.push(p.address);
  for (const a of Object.keys(state.tracking || {})) if (!addrs.includes(a)) addrs.push(a);
  for (const a of ctx.extraAddrs || []) if (!addrs.includes(a)) addrs.push(a);   // e.g. your real holdings

  const pairs = await pairsFor(addrs, get, sleep, cfg);
  const live = Object.fromEntries(Object.entries(pairs).map(([a, p]) => [a, measure(p, t0)]));

  // hot themes among coins that are actually trading this hour
  const active = Object.entries(live).filter(([, m]) => m.buys_h1 + m.sells_h1 >= cfg.min_txns_h1)
    .map(([a, m]) => ({ address: a, name: m.name, symbol: m.symbol, desc: (found[a] || state.watch[a]?.meta || {}).desc }));
  const themes = findThemes(active, cfg);
  const themeOf = new Map();
  for (const t of themes) for (const a of t.addrs) themeOf.set(a, [...(themeOf.get(a) || []), t.word]);

  const rows = [];
  let rugchecks = 0;
  const order = Object.keys(live).sort((a, b) => live[b].vol_h1 - live[a].vol_h1);
  for (const a of order) {
    const m = live[a];
    const hist = state.watch[a] ??= { first_seen: t0 };
    const meta = found[a] ? { ...(hist.meta || {}), ...found[a] } : hist.meta || { links: [], boost: 0, desc: '', sources: [] };
    const flags = basicFlags(m, cfg);
    let rc = null, pending = false;
    if (!flags.length) {
      const cached = rugCache?.get(a);
      if (cached && (t0 - cached.t) < cfg.rug_cache_min * 60_000) {
        rc = cached.rc;
      } else if (rugchecks < cfg.max_rugchecks) {
        rc = await rugReport(a, get);
        rugchecks++;
        if (rc && rugCache) rugCache.set(a, { t: t0, rc });
        await sleep(cfg.rug_gap_ms);
      } else {
        pending = true;   // over this scan's RugCheck budget: checked on a later scan
      }
      if (!pending) flags.push(...rugFlags(rc, cfg));
    }
    const buzz = buzzFresh ? buzzAll.coins?.[a] ?? null : null;
    const [sc, why, worry] = flags.length ? [0, [], []] : score(m, hist, rc, meta, buzz);
    if (pending) worry.unshift('safety check pending (next scan): cannot be a pick until checked');
    const coinThemes = themeOf.get(a) || [];
    if (coinThemes.length && !flags.length) why.push(`part of a hot theme right now: ${coinThemes.slice(0, 2).join(', ')}`);
    const verdict = flags.length ? 'SKIP' : !pending && sc >= cfg.pick_score ? 'WATCH' : 'WAIT';
    rows.push({
      address: a, symbol: m.symbol, name: m.name, url: m.url, dex: m.dex, quote: m.quote,
      price: m.price, mcap: Math.round(m.mcap), liq: m.liq == null ? null : Math.round(m.liq),
      age_h: Math.round(m.age_h * 10) / 10, chg_m5: m.chg_m5, chg_h1: m.chg_h1, chg_h24: m.chg_h24,
      vol_h1: Math.round(m.vol_h1), buys_h1: m.buys_h1, sells_h1: m.sells_h1, buys_m5: m.buys_m5, sells_m5: m.sells_m5,
      holders: rc ? rc.holders : null, top10_pct: rc ? rc.top10_pct : null,
      score: sc, verdict, reasons: why, concerns: worry, red_flags: flags,
      links: meta.links || [], boost: meta.boost || 0, sources: [...(meta.sources || [])].sort(),
      first_seen: hist.first_seen, buzz, themes: coinThemes,
      _feats: flags.length ? null : features(m, hist, rc, meta, buzz, coinThemes.length > 0),
    });
    hist.first_mcap ??= m.mcap;
    hist.last_mcap = m.mcap;
    hist.last_score = sc;
    hist.meta = meta;
    if (rc) hist.holders = rc.holders;
  }

  const rank = r => (r.verdict === 'WATCH' ? 0 : r.verdict === 'WAIT' ? 1 : 2);
  rows.sort((x, y) => rank(x) - rank(y) || y.score - x.score || y.vol_h1 - x.vol_h1);
  const picks = rows.filter(r => r.verdict === 'WATCH');
  const { closedNow, opened } = paperUpdate(paper, live, picks, t0, cfg);
  if (ctx.paperB) { ctx.paperB.open ??= []; ctx.paperB.closed ??= []; paperUpdate(ctx.paperB, live, picks, t0, cfg, 'ladder'); }
  const finished = cfg.track_outcomes ? trackOutcomes(state, rows, live, t0, cfg) : [];
  for (const r of rows) delete r._feats;

  const latest = {
    updated: iso(t0), updated_ms: t0,
    took_s: Math.round((Date.now() - startedAt) / 100) / 10,
    counts: { scanned: rows.length, watch: picks.length, wait: rows.filter(r => r.verdict === 'WAIT').length,
              skip: rows.filter(r => r.verdict === 'SKIP').length, rugchecks },
    buzz_fresh: buzzFresh, settings: cfg, coins: rows.slice(0, 120), closed_this_run: closedNow,
    themes: themes.map(({ word, coins }) => ({ word, coins })),
    tracking: Object.keys(state.tracking || {}).length,
  };
  const candidates = {
    updated: iso(t0),
    coins: rows.filter(r => r.verdict !== 'SKIP').slice(0, 25).map(r => ({
      address: r.address, symbol: r.symbol, name: r.name,
      x: r.links.filter(l => l.type === 'twitter').map(l => l.url) })),
  };
  return { latest, candidates, closedNow, opened, live, finished };
}
