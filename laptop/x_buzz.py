#!/usr/bin/env python3
"""
X buzz reader: runs on your Windows laptop every 30 minutes (Task Scheduler).

1. Downloads the coins the GitHub scanner flagged (docs/data/candidates.json).
2. Opens X search in a separate Chrome profile that you logged into yourself,
   searching each coin's contract address (exact, no name collisions) and
   cashtag, newest posts first.
3. Counts posts in the last hour, distinct accounts, and likes/reposts.
4. Uploads docs/data/buzz.json to your repo; the next scan adds it to scores.

It only reads. It never posts, likes or follows. It is still automated use of
X, which X's rules forbid, so it is kept slow: at most MAX_COINS searches per
run with random pauses. Your X account could still be limited or banned; use
a spare account if that matters to you.

Usage:
  python x_buzz.py --login   first time: opens Chrome so you can log in to X
  python x_buzz.py           normal run (what Task Scheduler calls)
  python x_buzz.py --dry     run without uploading, prints the results
"""
import argparse
import base64
import json
import os
import random
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
PROFILE = os.path.join(HERE, 'x-profile')          # separate from your normal Chrome
LOG = os.path.join(HERE, 'x_buzz_log.txt')
MAX_COINS = 10
PAUSE = (8, 20)                                      # seconds between searches


def env():
    """Reads laptop/.env: GITHUB_REPO=user/memecoin-radar and GITHUB_TOKEN=..."""
    cfg = {}
    p = os.path.join(HERE, '.env')
    if os.path.exists(p):
        for line in open(p, encoding='utf-8'):
            if '=' in line and not line.strip().startswith('#'):
                k, v = line.split('=', 1)
                cfg[k.strip()] = v.strip()
    return cfg


def log(msg):
    line = f"{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}  {msg}"
    print(line)
    with open(LOG, 'a', encoding='utf-8') as f:
        f.write(line + '\n')


def gh(cfg, path, method='GET', body=None):
    req = urllib.request.Request(
        f"https://api.github.com/repos/{cfg['GITHUB_REPO']}/contents/{path}",
        method=method, data=None if body is None else json.dumps(body).encode(),
        headers={'Authorization': f"Bearer {cfg['GITHUB_TOKEN']}", 'Accept': 'application/vnd.github+json',
                 'User-Agent': 'memecoin-radar-laptop'})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise


def fetch_candidates(cfg):
    j = gh(cfg, 'docs/data/candidates.json')
    if not j:
        return []
    return json.loads(base64.b64decode(j['content']).decode()).get('coins', [])


def upload_buzz(cfg, buzz):
    cur = gh(cfg, 'docs/data/buzz.json')
    body = {'message': 'x buzz ' + datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%MZ'),
            'content': base64.b64encode(json.dumps(buzz, indent=1).encode()).decode()}
    if cur:
        body['sha'] = cur['sha']
    gh(cfg, 'docs/data/buzz.json', 'PUT', body)


# Runs inside the X search page and returns the posts it can see.
READ_POSTS = r"""
() => [...document.querySelectorAll('article[data-testid="tweet"]')].map(a => {
  const t = a.querySelector('time');
  const user = [...a.querySelectorAll('a[href^="/"]')].map(x => x.getAttribute('href'))
                 .find(h => /^\/[A-Za-z0-9_]{1,15}$/.test(h));
  const num = id => { const el = a.querySelector(`[data-testid="${id}"]`);
                      const m = el && (el.getAttribute('aria-label') || '').match(/([\d,.]+)\s*([KkMm]?)/);
                      if (!m) return 0; let n = parseFloat(m[1].replace(/,/g, ''));
                      return Math.round(n * ({k: 1e3, m: 1e6}[m[2].toLowerCase()] || 1)); };
  return { time: t ? t.getAttribute('datetime') : null, user: user || null,
           likes: num('like') || num('unlike'), reposts: num('retweet') || num('unretweet') };
})
"""


def search(page, query, scrolls=3):
    url = 'https://x.com/search?' + urllib.parse.urlencode({'q': query, 'src': 'typed_query', 'f': 'live'})
    page.goto(url, wait_until='domcontentloaded', timeout=45_000)
    try:
        page.wait_for_selector('article[data-testid="tweet"]', timeout=12_000)
    except Exception:
        return []  # no results, or a login wall
    seen = {}
    for _ in range(scrolls):
        for p in page.evaluate(READ_POSTS):
            if p['time']:
                seen[(p['user'], p['time'])] = p
        page.mouse.wheel(0, 2500)
        page.wait_for_timeout(random.randint(1200, 2500))
    return list(seen.values())


def measure(posts, now):
    hour = [p for p in posts if (now - datetime.fromisoformat(p['time'].replace('Z', '+00:00'))).total_seconds() <= 3600]
    authors = {p['user'] for p in hour if p['user']}
    engage = sum(p['likes'] + 2 * p['reposts'] for p in hour)
    return {'posts_1h': len(hour), 'authors_1h': len(authors), 'engagement_1h': engage}


def buzz_score(m, prev):
    """0-100. Many different people posting beats one account spamming."""
    s = 45 * min(1, m['authors_1h'] / 25) + 25 * min(1, m['posts_1h'] / 40) + 15 * min(1, m['engagement_1h'] / 500)
    if prev and prev.get('authors_1h') is not None:
        growth = (m['authors_1h'] + 1) / (prev['authors_1h'] + 1)
        s += 15 * min(1, max(0, growth - 1))
    if m['posts_1h'] >= 10 and m['authors_1h'] <= 3:
        s *= 0.4  # a handful of accounts shilling on repeat
    return round(min(100, s))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--login', action='store_true')
    ap.add_argument('--dry', action='store_true')
    a = ap.parse_args()
    from playwright.sync_api import sync_playwright

    cfg = env()
    with sync_playwright() as pw:
        # HEADLESS=0 in .env shows the window: use it if X starts blocking the hidden browser
        hidden = (not a.login) and cfg.get('HEADLESS', '1') != '0'
        launch = dict(user_data_dir=PROFILE, headless=hidden, viewport={'width': 1200, 'height': 900})
        try:
            ctx = pw.chromium.launch_persistent_context(channel='chrome', **launch)
        except Exception:
            ctx = pw.chromium.launch_persistent_context(channel='msedge', **launch)
        page = ctx.pages[0] if ctx.pages else ctx.new_page()

        if a.login:
            page.goto('https://x.com/login')
            print('Log in to X in the window that opened. Close the window when you are done.')
            try:
                page.wait_for_event('close', timeout=0)
            except Exception:
                pass
            try:
                ctx.close()
            except Exception:
                pass
            print('Saved. The scheduled runs will use this login.')
            return

        if not cfg.get('GITHUB_REPO') or not cfg.get('GITHUB_TOKEN'):
            sys.exit('Missing laptop/.env with GITHUB_REPO and GITHUB_TOKEN')
        coins = fetch_candidates(cfg)[:MAX_COINS]
        if not coins:
            log('no candidates yet')
            ctx.close()
            return

        old = {}
        try:
            j = gh(cfg, 'docs/data/buzz.json')
            old = json.loads(base64.b64decode(j['content']).decode()).get('coins', {}) if j else {}
        except Exception:
            pass

        now = datetime.now(timezone.utc)
        out = {}
        for i, c in enumerate(coins):
            q = f"{c['address']} OR ${c['symbol']}" if c['symbol'].isascii() and len(c['symbol']) <= 12 else c['address']
            try:
                posts = search(page, q)
            except Exception as e:
                log(f"{c['symbol']}: search failed ({e.__class__.__name__})")
                continue
            if not posts and 'login' in page.url:
                log('X wants you to log in again: run "python x_buzz.py --login"')
                break
            m = measure(posts, now)
            m['score'] = buzz_score(m, old.get(c['address']))
            m['checked'] = now.strftime('%Y-%m-%dT%H:%M:%SZ')
            out[c['address']] = m
            log(f"{c['symbol']:>12}: {m['posts_1h']} posts / {m['authors_1h']} accounts in 1h -> buzz {m['score']}")
            if i < len(coins) - 1:
                time.sleep(random.uniform(*PAUSE))
        ctx.close()

    buzz = {'updated': int(time.time() * 1000), 'coins': out}
    if a.dry:
        print(json.dumps(buzz, indent=1))
    elif out:
        upload_buzz(cfg, buzz)
        log(f'uploaded buzz for {len(out)} coins')


if __name__ == '__main__':
    main()
