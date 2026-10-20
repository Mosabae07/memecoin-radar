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
