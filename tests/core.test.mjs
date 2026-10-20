// Offline tests: real DexScreener rows captured 2026-10-20, RugCheck answers shaped like the
// real reports (MONEYBIZ: 10 linked wallet groups holding 34.4% while its top 10 hold only 3%).
// Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runScan, CFG } from '../docs/radar-core.js';
import { run, setDataDir } from '../radar/scan.mjs';
import { NOW, FakeAPI } from './fixture.mjs';

const noSleep = async () => {};
const bySym = latest => Object.fromEntries(latest.coins.map(c => [c.symbol, c]));

async function scans(moves) {
  const api = new FakeAPI();
  const state = { watch: {} }, paper = { open: [], closed: [], ever: [] };
  const out = [];
  for (const [pm, bm, h] of moves) {
    api.priceMult = pm; api.buysMult = bm; api.holders = h;
    out.push((await runScan({ get: api.get, sleep: noSleep, now: NOW, state, paper })).latest);
  }
  return { out, paper, api };
}

test('skeptic, scoring and take-profit on real captured coins', async () => {
  const { out: [first, second], paper, api } = await scans([[1, 1, 900], [1.6, 1.5, 1500], [2.3, 1.5, 1500], [3.6, 1.5, 1500]]);
  const c1 = bySym(first);
  assert.equal(c1.TROAD.verdict, 'SKIP'); assert.ok(c1.TROAD.red_flags.some(f => f.includes('dumped')));
  assert.ok(c1.TROAD.red_flags.some(f => f.includes('below')));
  assert.equal(c1.Twyne.verdict, 'SKIP');
  assert.ok(c1['GTA 6 Coin'].red_flags.some(f => f.includes('days old')));
  assert.equal(c1.FREN.verdict, 'WAIT');
  assert.ok(c1.MINTY.red_flags.some(f => f.includes('mint')));
  assert.ok(c1.WHALE.red_flags.some(f => f.includes('top 10 wallets')));
  assert.ok(c1.THIN.red_flags.some(f => f.includes('liquidity')));
  assert.ok(first.coins.every(c => c.address !== '0xabc'));
  for (const s of ['WiSP', 'PSTR', 'Laura']) { assert.notEqual(c1[s].verdict, 'SKIP', s); assert.ok(c1[s].score > 0 && c1[s].score <= 100); }
  assert.equal(c1.MONEYBIZ.verdict, 'SKIP');
  assert.ok(c1.MONEYBIZ.red_flags.some(f => f.includes('linked wallet groups hold 34%')));
  assert.ok(c1.PSTR.concerns.some(w => w.includes('bonding curve')));
  assert.equal(first.counts.watch, 0, 'a first sighting must not be a pick');
  const c2 = bySym(second);
  assert.ok(c2.WiSP.score > c1.WiSP.score);
  assert.ok(c2.WiSP.reasons.some(r => r.includes('since the radar first saw it')));
  assert.ok(paper.summary.trades >= 1);
  for (const p of paper.closed) if (p.exit_reason === 'take profit') assert.ok(p.return_pct > 90);
  assert.ok(first.counts.rugchecks <= CFG.max_rugchecks);
  // same results as the original Python scanner on this data
  assert.deepEqual(Object.fromEntries(Object.entries(c1).map(([k, v]) => [k, v.score])),
    { WiSP: 62, FREN: 61, Laura: 55, PSTR: 50, MONEYBIZ: 0, MINTY: 0, WHALE: 0, THIN: 0, 'GTA 6 Coin': 0, Twyne: 0, TROAD: 0 });
  assert.deepEqual(paper.closed.map(p => [p.symbol, p.exit_reason, p.return_pct]), [['WiSP', 'take profit', 121], ['FREN', 'take profit', 121]]);
  assert.ok(api.calls.length > 0);
});

test('stop loss closes losing trades with costs charged', async () => {
  const { paper } = await scans([[1, 1, 900], [1.6, 1.5, 1500], [0.9, 1.5, 1500]]);
  assert.ok(paper.closed.length && paper.closed.every(p => p.exit_reason === 'stop loss' && p.return_pct < -35));
  assert.equal(paper.summary.win_rate, 0);
});

test('live mode reuses cached RugCheck reports', async () => {
  const api = new FakeAPI();
  const state = { watch: {} }, paper = { open: [], closed: [] }, rugCache = new Map();
  const cfg = { rug_cache_min: 10, max_rugchecks: 4 };
  await runScan({ get: api.get, sleep: noSleep, now: NOW, state, paper, rugCache, cfg });
  const firstRug = api.calls.filter(u => u.includes('rugcheck')).length;
  assert.equal(firstRug, 4, 'budget of 4 per live scan');
  await runScan({ get: api.get, sleep: noSleep, now: NOW + 30_000, state, paper, rugCache, cfg });
  const total = api.calls.filter(u => u.includes('rugcheck')).length;
  assert.ok(total - firstRug <= 4 && rugCache.size >= 6, 'second scan checks only coins not in the cache');
});

test('node runner writes the dashboard files', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'radar-'));
  setDataDir(dir);
  const api = new FakeAPI();
  await run({ get: api.get, wait: noSleep, now: NOW });
  for (const f of ['latest.json', 'paper.json', 'state.json', 'candidates.json'])
    JSON.parse(await readFile(path.join(dir, f), 'utf8'));
  const cand = JSON.parse(await readFile(path.join(dir, 'candidates.json'), 'utf8'));
  assert.ok(cand.coins.length >= 3 && cand.coins.every(c => c.x.length));
  await rm(dir, { recursive: true });
});

test('coins over the RugCheck budget wait for a check instead of being rejected or picked', async () => {
  const api = new FakeAPI();
  const state = { watch: {} }, paper = { open: [], closed: [] };
  const { latest } = await runScan({ get: api.get, sleep: noSleep, now: NOW, state, paper, cfg: { max_rugchecks: 1 } });
  const pending = latest.coins.filter(c => c.concerns.some(w => w.startsWith('safety check pending')));
  assert.ok(pending.length >= 2);
  assert.ok(pending.every(c => c.verdict === 'WAIT'));
});

// ---------------------------------------------------------------- phase 1: learning, exits, themes
import { computeStats, findThemes, themeWords, paperUpdate } from '../docs/radar-core.js';

test('outcomes: records numbers at first score, then price 1h / 6h / 24h later', async () => {
  const api = new FakeAPI();
  const state = { watch: {} }, paper = { open: [], closed: [] };
  const at = h => NOW + h * 3_600_000;
  const r0 = await runScan({ get: api.get, sleep: noSleep, now: at(0), state, paper });
  assert.deepEqual(r0.finished, []);
  const tracked = Object.keys(state.tracking);
  assert.ok(tracked.includes('WISPpump') && !tracked.includes('TROADpump'), 'only coins that pass the Skeptic are tracked');
  const f = state.tracking.WISPpump.feats;
  for (const k of ['buy_pressure_5m', 'volume_accel', 'holders', 'top10_pct', 'liquidity_ratio', 'hot_theme']) assert.ok(k in f, k);
  api.priceMult = 1.5; await runScan({ get: api.get, sleep: noSleep, now: at(1.1), state, paper });
  api.priceMult = 3.0; await runScan({ get: api.get, sleep: noSleep, now: at(6.2), state, paper });
  api.priceMult = 0.8; const done = await runScan({ get: api.get, sleep: noSleep, now: at(24.3), state, paper });
  const w = done.finished.find(o => o.symbol === 'WiSP');
  assert.ok(w, 'finished after 24h');
  assert.equal(w.r1h, 50); assert.equal(w.r6h, 200); assert.equal(w.r24h, -20); assert.equal(w.peak, 200); assert.equal(w.trough, -20);
  assert.ok(!state.tracking.WISPpump, 'removed from tracking once finished');
});

test('stats: show which score bands and signals actually led to gains', () => {
  const outs = [];
  for (let i = 0; i < 60; i++) {
    const good = i % 2 === 0;
    outs.push({ score: good ? 82 : 55, peak: good ? 120 : 10, trough: good ? -10 : -85, r24h: good ? 40 : -70,
                feats: { holders: good ? 1500 + i : 200 + i, paid_boosts: i % 3 } });
  }
  const st = computeStats(outs);
  assert.equal(st.total.n, 60);
  const b80 = st.bands.find(b => b.label === '80+'), b50 = st.bands.find(b => b.label === '50-59');
  assert.equal(b80.hit100, 100); assert.equal(b50.hit50, 0); assert.equal(b50.crash, 100);
  assert.equal(st.signals[0].signal, 'holders', 'the signal that separates winners is ranked first');
  assert.ok(st.signals[0].lift > 50);
});

test('exit rule B sells half at take profit and trails the rest', () => {
  const now = NOW, cfg = { ...CFG };
  const pick = { address: 'X', symbol: 'X', url: '', price: 1, mcap: 1, score: 80 };
  const A = { open: [], closed: [] }, B = { open: [], closed: [] };
  const px = p => ({ X: { price: p } });
  for (const P of [A]) paperUpdate(P, px(1), [pick], now, cfg);
  paperUpdate(B, px(1), [pick], now, cfg, 'ladder');
  // runs to 3x then fades to 2x: A sold everything at 2.2x on the way up; B sold half at 2.2x and the rest at 2.0x after peaking at 3x
  for (const [i, p] of [2.2, 3.0, 2.0].entries()) {
    paperUpdate(A, px(p), [], now + (i + 1) * 60_000, cfg);
    paperUpdate(B, px(p), [], now + (i + 1) * 60_000, cfg, 'ladder');
  }
  assert.equal(A.closed[0].exit_reason, 'take profit'); assert.equal(A.closed[0].return_pct, 116);
  assert.ok(B.closed[0].exit_reason.startsWith('trailing stop')); assert.equal(B.closed[0].return_pct, 106);
  // runs to 5x and fades to 3.4x: B wins
  const A2 = { open: [], closed: [] }, B2 = { open: [], closed: [] };
  paperUpdate(A2, px(1), [pick], now, cfg); paperUpdate(B2, px(1), [pick], now, cfg, 'ladder');
  for (const [i, p] of [2.1, 5.0, 3.4].entries()) {
    paperUpdate(A2, px(p), [], now + (i + 1) * 60_000, cfg); paperUpdate(B2, px(p), [], now + (i + 1) * 60_000, cfg, 'ladder');
  }
  assert.ok(B2.closed[0].return_pct > A2.closed[0].return_pct);
  // before take profit, B still has the normal stop loss
  const B3 = { open: [], closed: [] };
  paperUpdate(B3, px(1), [pick], now, cfg, 'ladder'); paperUpdate(B3, px(0.6), [], now + 60_000, cfg, 'ladder');
  assert.equal(B3.closed[0].exit_reason, 'stop loss');
});

test('themes: words shared by several trading coins, ignoring filler', () => {
  assert.deepEqual(themeWords({ name: 'Pumpkin Pepe', symbol: 'PUMPE', desc: 'The spookiest frog on Solana' }).sort(), ['frog', 'pepe', 'pumpe', 'pumpkin', 'spookiest']);
  const coins = [
    { address: 'a', name: 'Halloween Cat', symbol: 'HCAT' }, { address: 'b', name: 'Pumpkin Dog', symbol: 'PDOG', desc: 'halloween season' },
    { address: 'c', name: 'Spooky Halloween', symbol: 'SPOOK' }, { address: 'd', name: 'Solana Coin', symbol: 'SOL2' }];
  const t = findThemes(coins);
  assert.equal(t[0].word, 'halloween'); assert.equal(t[0].coins, 3);
  assert.ok(!t.some(x => ['solana', 'coin'].includes(x.word)));
});

test('runner saves outcomes, stats and the second paper ledger', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'radar-'));
  setDataDir(dir);
  const api = new FakeAPI();
  await run({ get: api.get, wait: noSleep, now: NOW });
  for (const f of ['paper_b.json', 'outcomes.json', 'stats.json']) JSON.parse(await readFile(path.join(dir, f), 'utf8'));
  const st = JSON.parse(await readFile(path.join(dir, 'stats.json'), 'utf8'));
  assert.ok(st.tracking_now >= 3 && st.total.n === 0);
  await rm(dir, { recursive: true });
});

test('pump.fun feed: graduations and dev buys flow into reasons and tracked numbers', async () => {
  const api = new FakeAPI();
  const state = { watch: {} }, paper = { open: [], closed: [] };
  const { latest } = await runScan({ get: api.get, sleep: noSleep, now: NOW, state, paper,
    extraFound: { WISPpump: { sources: ['pump.fun graduation'], graduated_at: NOW - 6 * 60000 },
                  LAURApump: { sources: ['pump.fun launch'], dev_buy_pct: 14.2, launched_at: NOW - 20 * 60000 } } });
  const by = Object.fromEntries(latest.coins.map(c => [c.symbol, c]));
  assert.ok(by.WiSP.reasons.some(r => r === 'graduated from pump.fun 6 min ago (now in an open pool)'));
  assert.ok(by.WiSP.sources.includes('pump.fun graduation'));
  assert.ok(by.Laura.concerns.some(w => w === 'creator bought 14% of supply at launch'));
  assert.equal(state.tracking.WISPpump.feats.graduated_recently, 1);
  assert.equal(state.tracking.LAURApump.feats.dev_buy_pct, 14.2);
  // scores are unchanged by the feed: it informs, the tracking decides later whether it should count
  const plain = await runScan({ get: new FakeAPI().get, sleep: noSleep, now: NOW, state: { watch: {} }, paper: { open: [], closed: [] } });
  assert.equal(Object.fromEntries(plain.latest.coins.map(c => [c.symbol, c.score])).WiSP, by.WiSP.score);
  assert.ok(themeWords({ name: 'Pepémon', symbol: 'PKMN', desc: 'every pokémon' }).includes('pokemon'));
});
