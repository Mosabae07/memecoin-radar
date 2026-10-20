"""Checks the X page reader and buzz scoring against a page shaped like X search results.
Needs: pip install playwright (uses a local Chromium). Run: python3 tests/test_x_buzz.py"""
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'laptop'))
import x_buzz  # noqa: E402

NOW = datetime.now(timezone.utc)


def post(user, mins_ago, likes, reposts):
    t = (NOW - timedelta(minutes=mins_ago)).strftime('%Y-%m-%dT%H:%M:%S.000Z')
    return f'''<article data-testid="tweet"><div><a href="/{user}">@{user}</a>
      <a href="/{user}/status/1"><time datetime="{t}">{mins_ago}m</time></a></div><p>$TEST to the moon</p>
      <div role="group"><button data-testid="reply" aria-label="3 Replies. Reply"></button>
      <button data-testid="retweet" aria-label="{reposts} reposts. Repost"></button>
      <button data-testid="like" aria-label="{likes} Likes. Like"></button></div></article>'''


def page_html():
    posts = [post(f'user{i}', 5 + i * 3, 12 + i, 2) for i in range(14)]       # 14 accounts, last hour
    posts += [post('shill', 10 + i, 0, 0) for i in range(6)]                   # one account spamming
    posts += [post('olduser', 90, 1500, 300)]                                  # outside the hour
    posts += [post('bigacct', 20, 1200, 0).replace('1200 Likes', '1.2K Likes')]  # K suffix
    return '<html><body>' + ''.join(posts) + '</body></html>'


def test_reader_and_score():
    from playwright.sync_api import sync_playwright
    path = os.path.join(os.path.dirname(__file__), '_x_fixture.html')
    open(path, 'w').write(page_html())
    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch(executable_path='/opt/pw-browsers/chromium')
            p = b.new_page()
            p.goto('file://' + path)
            posts = p.evaluate(x_buzz.READ_POSTS)
            b.close()
    finally:
        os.remove(path)
    assert len(posts) == 22
    assert any(x['likes'] == 1200 for x in posts), 'K suffix not parsed'
    assert all(x['user'] for x in posts)
    m = x_buzz.measure(posts, NOW)
    assert m['posts_1h'] == 21 and m['authors_1h'] == 16, m      # olduser excluded
    s = x_buzz.buzz_score(m, None)
    assert 30 < s < 80, s
    grown = x_buzz.buzz_score(m, {'authors_1h': 4})
    assert grown > s, 'growth since last check should raise the score'
    spam = x_buzz.buzz_score({'posts_1h': 30, 'authors_1h': 2, 'engagement_1h': 50}, None)
    assert spam < 20, spam
    print('posts', len(posts), '| measure', m, '| score', s, '| grown', grown, '| spam', spam)


if __name__ == '__main__':
    test_reader_and_score()
    print('OK')
