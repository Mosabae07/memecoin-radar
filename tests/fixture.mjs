// Real DexScreener rows captured 2026-10-20 and RugCheck answers shaped like the real reports.
export const NOW = Date.now();
const H = 3_600_000;
// [address, symbol, dex, quote, price, b_m5, s_m5, b_h1, s_h1, b_h24, s_h24,
//  vol_m5, vol_h1, vol_h24, chg_m5, chg_h1, chg_h24, liq, mcap, age_hours, boost, socials]
export const ROWS = [
  ['MONEYBIZpump', 'MONEYBIZ', 'pumpswap', 'SOL', 0.0008953, 460, 339, 6306, 3153, 6306, 3153, 40193, 838981, 838981, 5.31, 1223, 1223, 82215, 888990, 0.8, 0, 'twitter'],
  ['WISPpump', 'WiSP', 'pumpswap', 'SOL', 0.00005961, 155, 107, 666, 492, 666, 492, 11955, 45959, 45959, 44.68, 38.71, 38.71, 19273, 59618, 0.3, 30, 'twitter|telegram'],
  ['PSTRpump', 'PSTR', 'pumpfun', 'SOL', 0.00002854, 191, 132, 1426, 1313, 1426, 1313, 12518, 91389, 91389, 2.03, 789, 789, null, 28547, 0.2, 0, 'twitter'],
  ['LAURApump', 'Laura', 'pumpswap', 'SOL', 0.0001029, 162, 101, 1704, 933, 1704, 933, 21066, 188618, 188618, -35.61, 129, 129, 26525, 98252, 0.6, 0, 'twitter'],
  ['TROADpump', 'TROAD', 'pumpswap', 'SOL', 0.00000226, 0, 0, 0, 0, 6228, 5960, 0, 0, 610045, 0, 0, -94.8, 2440, 2177, 9.5, 50, 'twitter'],
  ['TWYNEpump', 'Twyne', 'pumpswap', 'SOL', 0.000002553, 0, 0, 0, 3, 12276, 15197, 0, 7, 1408973, 0, -0.83, -94.1, 2861, 2437, 11, 100, 'twitter'],
  ['GTA6pump', 'GTA 6 Coin', 'raydium', 'SOL', 0.001103, 0, 1, 14, 3, 181, 130, 21, 1551, 20146, -0.19, -0.97, 3.48, 152011, 1102238, 6380, 10, 'twitter|telegram'],
  ['FRENpump', 'FREN', 'pumpfun', 'SOL', 0.00001717, 328, 203, 328, 203, 328, 203, 33994, 33994, 33994, 474, 474, 474, null, 17172, 0.05, 0, 'twitter'],
  ['MINTpump', 'MINTY', 'pumpswap', 'SOL', 0.0001, 200, 100, 1500, 900, 1500, 900, 15000, 120000, 120000, 10, 80, 80, 30000, 150000, 1.0, 0, 'twitter'],
  ['WHALEpump', 'WHALE', 'pumpswap', 'SOL', 0.0002, 150, 90, 1200, 800, 1200, 800, 9000, 90000, 90000, 5, 60, 60, 25000, 200000, 2.0, 0, 'twitter'],
  ['THINpump', 'THIN', 'pumpswap', 'SOL', 0.0003, 100, 80, 900, 700, 900, 700, 5000, 50000, 50000, 2, 30, 30, 4000, 300000, 3.0, 0, 'twitter'],
];

export function pair(r, priceMult = 1, buysMult = 1) {
  const [a, sym, dex, q, price, bm5, sm5, bh1, sh1, b24, s24, vm5, vh1, v24, cm5, ch1, c24, liq, mcap, age, , socials] = r;
  return {
    chainId: 'solana', dexId: dex, url: `https://dexscreener.com/solana/${a.toLowerCase()}`, pairAddress: 'P' + a,
    baseToken: { address: a, symbol: sym, name: sym }, quoteToken: { symbol: q }, priceUsd: String(price * priceMult),
    txns: { m5: { buys: Math.trunc(bm5 * buysMult), sells: sm5 }, h1: { buys: bh1, sells: sh1 }, h24: { buys: b24, sells: s24 } },
    volume: { m5: vm5, h1: vh1, h24: v24 }, priceChange: { m5: cm5, h1: ch1, h24: c24 },
    liquidity: liq == null ? null : { usd: liq }, marketCap: mcap * priceMult, fdv: mcap * priceMult,
    pairCreatedAt: NOW - Math.trunc(age * H),
    info: { socials: socials.split('|').filter(Boolean).map(s => ({ type: s, url: `https://x.com/${sym}` })), websites: [{ url: 'https://example.com' }] },
  };
}

export function rug(addr, holders) {
  const r = { mintAuthority: null, freezeAuthority: null, rugged: false, totalHolders: holders,
    topHolders: Array.from({ length: 10 }, (_, i) => ({ owner: `w${i}`, address: `h${i}`, pct: 2, insider: false })),
    insiderNetworks: [], graphInsidersDetected: 0, creatorBalance: 0, token: { supply: 1_000_000_000 },
    creatorTokens: [], risks: [], markets: [], knownAccounts: {} };
  if (addr === 'MINTpump') r.mintAuthority = 'Creator111';
  if (addr === 'WHALEpump') r.topHolders[0].pct = 40;
  if (addr === 'MONEYBIZpump') r.insiderNetworks = Array(10).fill({ currentHolding: 34_400_000 });
  if (addr === 'LAURApump') r.insiderNetworks = [{ currentHolding: 25_000_000 }];
  return r;
}

export class FakeAPI {
  priceMult = 1; buysMult = 1; holders = 900; calls = [];
  get = async url => {
    this.calls.push(url);
    if (url.includes('/token-profiles/latest')) return [...ROWS.map(r => ({ chainId: 'solana', tokenAddress: r[0], links: [{ type: 'twitter', url: 'https://x.com/' + r[1] }], description: r[1] })), { chainId: 'bsc', tokenAddress: '0xabc' }];
    if (url.includes('/token-boosts/')) return ROWS.filter(r => r[20]).map(r => ({ chainId: 'solana', tokenAddress: r[0], totalAmount: r[20] }));
    if (url.includes('/community-takeovers/')) return [];
    if (url.includes('/tokens/v1/solana/')) { const want = url.split('/').pop().split(','); return ROWS.filter(r => want.includes(r[0])).map(r => pair(r, this.priceMult, this.buysMult)); }
    if (url.includes('rugcheck')) return rug(url.split('/tokens/')[1].split('/')[0], this.holders);
    throw new Error('unexpected url ' + url);
  };
}

