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

Every threshold is in `CFG` at the top of `docs/radar-core.js`. The 15-minute scanner and live mode both use that one file, so they always apply the same rules.

## Learning what works

- **Outcome tracking:** every coin that passes the Skeptic is followed for 24 hours. Its numbers at first sight are saved with its price 1 h, 6 h and 24 h later and its peak and low (`docs/data/outcomes.json`).
- **What's working** panel: win rates by score band (reached +50%, +100%, crashed −80%, median after 24 h), and for each signal, how coins high on it did against coins low on it. Use it to re-weight the score once there are 50+ finished coins.
- **Exit rule test:** every pick is paper-traded twice. A sells everything at +100% / −35% / 24 h. B sells half at +100% and trails the rest with a 30% stop from its peak. The dashboard shows which earns more on the same picks.
- **Hot themes:** words shared by 3+ coins that are actually trading (for example *halloween*, *pokemon*) are shown at the top and tagged on coins. They're tracked as a signal but don't change the score until the data says they help.

## Live session mode

On the dashboard, press **Start live session** when you sit down to trade:

- Scans every 20, 30 or 60 seconds (you choose) right in that browser tab, on a laptop or a phone. No GitHub wait.
- **Alerts** for each new pick, for a pick that turns bad (dumps or fails a safety check), and for each paper trade opening and closing. You get a sound, a desktop notification and a flashing tab title when you're in another tab.
- Its own **session paper trades**, separate from the 24/7 record.
- Starts from the 24/7 scanner's memory, so "growth since first seen" works from the first live scan.
- Keeps the screen awake while on. Survives a page reload. Stops when you press **Stop** or close the tab.
- **pump.fun live feed (free, on by default):** connects to PumpPortal's free stream of every new pump.fun launch and every graduation (a coin filling its launch curve and moving to an open pool). Graduations go straight into the next scan with a "graduated N min ago" reason. Launches are checked at about 8 and 30 minutes old, and the ones that clear the size and activity floor join the watchlist before DexScreener lists them. The creator's launch buy is shown as a concern at 10%+, and the most-launched themes of the last hour appear as chips. Both are recorded for outcome tracking but don't change scores yet. PumpPortal's per-trade feed is paid, so it isn't used.
- Polite to the free APIs: 4 RugCheck reports per scan, each reused for 10 minutes. A coin waiting for its check shows "safety check pending" and can't become a pick until it's checked.

## Real trading (optional, off by default)

Open **Real trading** on the dashboard and tick the acknowledgement to add a **Buy** button to picks:

- Swaps run through **Jupiter's free swap widget**. You connect your own wallet (Phantom, Solflare, Backpack) inside it and approve every trade there. The dashboard never sees your keys and can't spend on its own.
- **Your limits:** default buy, max per trade and daily limit, in SOL. They're checked before the swap opens, and the amount is locked in the swap window.
- Buy shows on **picks only** (optionally also "Watching" coins), never on rejected coins. Every buy starts with a check screen: score, reasons, concerns, and links to the chart and RugCheck.
- **My real trades** lists each buy with the estimated return, a Solscan link and a **Sell** button (Jupiter opens with the coin selected; you choose how much). The list is saved in that browser only; your wallet is the real record.
- **Quick buy (optional):** one tap buys your default amount on picks scoring at or above a threshold you set (80 by default), skipping the check screen. Your limits still apply, you still approve in your wallet, it won't quick-buy a coin you already hold, and a double tap opens only one swap.
- **Sell alerts** on every coin you hold: take profit, stop loss, trailing stop (once up 30%+), sellers taking over (2:1 sells in 5 min with price falling), or a new red flag. Each fires once, with the reason and a Sell button. Your thresholds are in the Real trading panel.
- Jupiter loads as soon as Real trading is on, so the swap window opens without waiting.
- Nothing buys automatically.

## Files

```
docs/radar-core.js            the rules: discovery, Skeptic, scoring, paper trading
radar/scan.mjs                15-minute scanner GitHub runs (Node, no installs)
.github/workflows/scan.yml    runs it every 15 min and saves results
docs/index.html               the dashboard + live session mode (GitHub Pages)
docs/data/                    latest, paper, paper_b, outcomes, stats, state, candidates, buzz (.json)
laptop/                       X buzz reader + one-click Windows setup
tests/                        offline tests on real captured market data (node --test tests/*.test.mjs)
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
- **Live mode needs the browser to reach DexScreener and RugCheck directly.** Some ad or privacy blockers stop that; the page says so if scans keep failing.
- **Solana only,** because the free scam checks (RugCheck) cover Solana.
