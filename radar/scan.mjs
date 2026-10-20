#!/usr/bin/env node
// The 15-minute scan GitHub Actions runs. All rules live in docs/radar-core.js,
// which the dashboard's live session mode uses too.
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { runScan } from '../docs/radar-core.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export let DATA = path.join(ROOT, 'docs', 'data');
export const setDataDir = d => { DATA = d; };

const UA = { 'User-Agent': 'memecoin-radar/1.0 (+github actions)', Accept: 'application/json' };
const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function getJson(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(25_000) });
      if (r.status === 429 && i < tries - 1) { await sleep(5000 * (i + 1)); continue; }
      if (r.status === 400 || r.status === 404) return null;
      if (!r.ok) { if (i === tries - 1) console.error(`  ! ${url} -> HTTP ${r.status}`); else await sleep(2000); continue; }
      return await r.json();
    } catch (e) {
      if (i === tries - 1) { console.error(`  ! ${url} -> ${e.message}`); return null; }
      await sleep(2000);
    }
  }
  return null;
}

async function load(name, fallback) {
  try { return JSON.parse(await readFile(path.join(DATA, name), 'utf8')); } catch { return fallback; }
}
async function save(name, obj) {
  await mkdir(DATA, { recursive: true });
  const p = path.join(DATA, name);
  await writeFile(p + '.tmp', JSON.stringify(obj, null, 1));
  await rename(p + '.tmp', p);
}

export async function run({ get = getJson, wait = sleep, now } = {}) {
  const state = await load('state.json', { watch: {} });
  const paper = await load('paper.json', { open: [], closed: [], ever: [] });
  const buzz = await load('buzz.json', { updated: 0, coins: {} });
  const { latest, candidates } = await runScan({ get, sleep: wait, now: now ?? Date.now(), state, paper, buzz });
  await save('latest.json', latest);
  await save('paper.json', paper);
  await save('state.json', state);
  await save('candidates.json', candidates);
  const c = latest.counts;
  console.log(`scanned ${c.scanned} | watch ${c.watch} | wait ${c.wait} | skip ${c.skip} | rugchecks ${c.rugchecks} | ` +
              `paper open ${paper.open.length} closed ${paper.closed.length} | ${latest.took_s}s`);
  return latest;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().catch(e => { console.error(e); process.exit(1); });
}
