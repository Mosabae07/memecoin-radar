# Memecoin Radar

A free early-signal scanner for new Solana meme coins. Every 15 minutes it scans for coins whose trading and holder numbers are speeding up, throws out the obvious scams, explains every call, and paper-trades its picks so you can see whether it actually works.

**It does not predict prices.** Most new meme coins go to zero and many are rug pulls. A high score means momentum is building and no scam markers were found. That's all. It never buys anything. Not financial advice.

## How it works

| Step | What happens | Source (free) |
|---|---|---|
| Discover | New token profiles, community takeovers and boosted coins, plus every coin still on the 24 h watchlist | DexScreener API |
| Measure | Price, market cap, liquidity, 5 min / 1 h / 24 h volume, buys vs sells | DexScreener API |
| Skeptic | Automatic **SKIP** for: already dumped (-60% in 24 h), under $15K or over $5M market cap, under 60 trades an hour, older than 7 days, thin liquidity, mint or freeze rights still on, top 10 wallets over 35%, linked insider wallet groups over 20%, creator over 5%, serial launchers, RugCheck "danger" | DexScreener + RugCheck full report |
| Score 0-100 | Buy pressure (20), volume acceleration (20), market cap growth across scans (20), holder growth (10), size sweet spot (10), real socials (10), X buzz (10). Heavy paid boosting is a penalty, not a plus | |
| Verdict | **WATCH** at 70+, **WAIT** below. A first sighting can't reach 70 on its own: it needs to hold up on a later scan | |
| Paper trade | $100 per WATCH pick. Take profit at +100%, stop at -35%, exit after 24 h, 4% fees and slippage charged | |
| X buzz | Laptop reader searches X for each flagged coin: posts and distinct accounts in the last hour, likes and reposts, growth since the last check. Spam from a few accounts is discounted | Your logged-in X, on your laptop |

Every threshold is in `CFG` at the top of `radar/scan.py`.

## Files

```
radar/scan.py                 the scanner (Python standard library only)
.github/workflows/scan.yml    runs it every 15 min and saves results
docs/index.html               the dashboard (GitHub Pages)
docs/data/                    latest.json, paper.json, state.json, candidates.json, buzz.json
laptop/                       X buzz reader + one-click Windows setup
tests/                        offline tests on real captured market data
```

## Setup

1. **Repo.** Push this folder to a public GitHub repo. Public repos get unlimited free Actions minutes and free Pages hosting.
2. **Dashboard.** Repo → Settings → Pages → Source: *Deploy from a branch*, Branch: `main`, folder `/docs`. It appears at `https://<you>.github.io/memecoin-radar/`.
3. **Scanner.** Repo → Actions → enable workflows → *scan* → **Run workflow** once. After that it runs every 15 minutes on its own.
4. **X buzz (optional, laptop).** Create a fine-grained token (GitHub → Settings → Developer settings → Fine-grained tokens; only this repo; *Contents: Read and write*). Copy the `laptop` folder to your laptop, double-click `setup_laptop.bat`, paste the token into the `.env` file it opens, and log in to X in the window that appears.

## Known limits

- **X rules.** Reading X automatically breaks X's terms. The reader is slow and read-only (10 searches per run, random pauses), but your account could still be limited. Consider a spare account. If X blocks the hidden browser, set `HEADLESS=0` in `laptop/.env`.
- **Timing.** GitHub can start scheduled runs a few minutes late, and prices are only checked every 15 minutes. Real entries and exits on fast coins would differ from the paper results.
- **Pause after 60 days.** GitHub pauses schedules on repos with no activity for 60 days. The scan's own commits normally count as activity, but if it stops, re-enable it under Actions.
- **Solana only,** because the free scam checks (RugCheck) cover Solana.
