from __future__ import annotations

from types import SimpleNamespace

from nyan.security.guards import protected_reason
from nyan.security.raid import JoinRateDetector, LockdownState, is_new_account


def test_join_rate_triggers_at_threshold():
    d = JoinRateDetector()
    results = [d.record(1, uid, now=100 + uid * 0.5, threshold=5, window_seconds=10) for uid in range(5)]
    assert results == [False, False, False, False, True]


def test_slow_joins_do_not_trigger():
    d = JoinRateDetector()
    assert not any(d.record(1, uid, now=uid * 6, threshold=3, window_seconds=10) for uid in range(20))


def test_guilds_are_independent_and_recent_lists_raiders():
    d = JoinRateDetector()
    for uid in range(3):
        d.record(1, uid, now=10, threshold=10, window_seconds=10)
    assert not d.record(2, 99, now=10, threshold=2, window_seconds=10)
    assert d.recent(1, now=12, window_seconds=10) == [0, 1, 2]
    assert d.recent(1, now=30, window_seconds=10) == []
    d.reset(1)
    assert d.recent(1, now=12, window_seconds=10) == []


def test_memory_is_bounded():
    d = JoinRateDetector(max_guilds=3)
    for uid in range(1000):
        d.record(1, uid, now=0, threshold=10_000, window_seconds=10_000)
    assert len(d._joins[1]) <= 200
    for gid in range(10):
        d.record(gid + 100, 1, now=0, threshold=5, window_seconds=10)
    assert len(d._joins) == 3


def test_lockdown_lifecycle():
    ls = LockdownState()
    assert not ls.is_active(1, 0)
    ls.start(1, now=100, duration_seconds=60)
    assert ls.is_active(1, 130)
    assert not ls.is_active(1, 160)  # auto-expired
    assert not ls.is_active(1, 130)  # and stays gone
    ls.start(1, 0, 10)
    ls.start(2, 0, 100)
    assert ls.expire(50) == [1]
    assert ls.end(2) is True and ls.end(2) is False


def test_new_account_check():
    assert is_new_account(created_ts=1000, now=1000 + 86400, min_age_days=3)
    assert not is_new_account(created_ts=0, now=10 * 86400, min_age_days=3)
    assert not is_new_account(created_ts=1000, now=1001, min_age_days=0)  # disabled


def _member(uid=5, *, admin=False, manage_messages=False, role=1, owner_id=1):
    return SimpleNamespace(
        id=uid,
        guild=SimpleNamespace(owner_id=owner_id),
        guild_permissions=SimpleNamespace(administrator=admin, manage_messages=manage_messages),
        top_role=role,
    )


def test_protected_reason():
    me = SimpleNamespace(id=99, top_role=10)
    assert protected_reason(_member(), me) is None
    assert protected_reason(_member(uid=1), me) == "server owner"
    assert protected_reason(_member(admin=True), me) == "administrator"
    assert protected_reason(_member(manage_messages=True), me)
    assert protected_reason(_member(manage_messages=True), me, check_mod=False) is None
    assert protected_reason(_member(role=10), me).startswith("role")
    assert protected_reason(_member(role=11), me).startswith("role")
    assert protected_reason(_member(uid=99), me) == "myself"
    assert protected_reason(_member(), None)
