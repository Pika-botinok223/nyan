from __future__ import annotations

from nyan.security.spam import DuplicateSpamDetector, normalize, similar


def feed(d, channels, *, user=1, start=0.0, step=1.0, text="Buy cheap followers at my-site now!", **kw):
    hit = None
    for i, ch in enumerate(channels):
        hit = d.record(1, user, ch, 1000 + i, text, start + i * step, **kw)
    return hit


def test_triggers_on_three_channels():
    d = DuplicateSpamDetector()
    hit = feed(d, [10, 20, 30])
    assert hit is not None
    assert hit.channel_count == 3
    assert sorted(hit.messages) == [(10, 1000), (20, 1001), (30, 1002)]


def test_not_triggered_by_two_channels_or_same_channel():
    d = DuplicateSpamDetector()
    assert feed(d, [10, 20]) is None
    d = DuplicateSpamDetector()
    assert feed(d, [10, 10, 10, 10, 10]) is None


def test_window_expiry():
    d = DuplicateSpamDetector()
    assert feed(d, [10, 20, 30], step=20, window_seconds=30) is None  # 40s span, never 3 within 30s


def test_similar_messages_and_case_whitespace():
    d = DuplicateSpamDetector()
    assert d.record(1, 1, 10, 1, "Free   NITRO here: bit.ly/abc123", 0) is None
    assert d.record(1, 1, 20, 2, "free nitro here: bit.ly/abc124", 1) is None
    assert d.record(1, 1, 30, 3, "free nitro here: bit.ly/abc125", 2) is not None


def test_different_messages_and_users_do_not_mix():
    d = DuplicateSpamDetector()
    texts = ["hello everyone how are you", "what a lovely day today", "anyone want to play some games"]
    assert not any(d.record(1, 1, ch, ch, t, ch) for ch, t in zip((10, 20, 30), texts))
    d = DuplicateSpamDetector()
    for user, ch in ((1, 10), (2, 20), (3, 30)):
        assert d.record(1, user, ch, ch, "same text from different people", 0) is None


def test_short_messages_ignored_and_no_retrigger():
    d = DuplicateSpamDetector()
    assert feed(d, [1, 2, 3, 4], text="lol") is None
    d = DuplicateSpamDetector()
    assert feed(d, [10, 20, 30]) is not None
    assert d.record(1, 1, 40, 5000, "Buy cheap followers at my-site now!", 4) is None  # burst already consumed


def test_memory_bounded():
    d = DuplicateSpamDetector(max_users=10)
    for uid in range(100):
        d.record(1, uid, 1, uid, "some long enough message", 0, min_channels=3)
    assert len(d._seen) == 10
    for _ in range(100):
        d.record(1, 1, 1, 1, "x" * 50, 0, min_channels=3)
    assert len(d._seen[(1, 1)]) <= 20
    d.prune(now=10_000)
    assert len(d._seen) == 0


def test_normalize_similar():
    assert normalize("  A   B\n C ") == "a b c"
    assert similar("abc", "abc") and not similar("abc", "xyz")
