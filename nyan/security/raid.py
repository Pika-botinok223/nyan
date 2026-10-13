from __future__ import annotations

from collections import OrderedDict, deque

MAX_TRACKED_GUILDS = 2000
MAX_JOINS_PER_GUILD = 200  # hard bound on the per-guild deque regardless of configuration


class JoinRateDetector:
    """Sliding-window join-rate detector.

    ``record`` takes the thresholds on every call so settings can change live. Each guild keeps a bounded
    deque of ``(timestamp, user_id)`` and guilds are LRU-evicted, so memory stays bounded.
    """

    def __init__(self, max_guilds: int = MAX_TRACKED_GUILDS) -> None:
        self._joins: OrderedDict[int, deque[tuple[float, int]]] = OrderedDict()
        self._max_guilds = max_guilds

    def _window(self, guild_id: int) -> deque[tuple[float, int]]:
        window = self._joins.get(guild_id)
        if window is None:
            window = self._joins[guild_id] = deque(maxlen=MAX_JOINS_PER_GUILD)
            while len(self._joins) > self._max_guilds:
                self._joins.popitem(last=False)
        else:
            self._joins.move_to_end(guild_id)
        return window

    def record(self, guild_id: int, user_id: int, now: float, threshold: int, window_seconds: float) -> bool:
        """Record a join; return True if ``threshold`` or more joins happened within the window."""
        joins = self._window(guild_id)
        joins.append((now, user_id))
        cutoff = now - window_seconds
        while joins and joins[0][0] < cutoff:
            joins.popleft()
        return len(joins) >= min(threshold, MAX_JOINS_PER_GUILD)

    def recent(self, guild_id: int, now: float, window_seconds: float) -> list[int]:
        """User ids that joined within the window (oldest first, de-duplicated)."""
        cutoff = now - window_seconds
        seen: dict[int, None] = {}
        for ts, uid in self._joins.get(guild_id, ()):
            if ts >= cutoff:
                seen[uid] = None
        return list(seen)

    def reset(self, guild_id: int) -> None:
        self._joins.pop(guild_id, None)


class LockdownState:
    """Tracks which guilds are in lockdown and when it expires (epoch seconds)."""

    def __init__(self) -> None:
        self._until: dict[int, float] = {}

    def start(self, guild_id: int, now: float, duration_seconds: float) -> float:
        self._until[guild_id] = now + duration_seconds
        return self._until[guild_id]

    def end(self, guild_id: int) -> bool:
        return self._until.pop(guild_id, None) is not None

    def is_active(self, guild_id: int, now: float) -> bool:
        until = self._until.get(guild_id)
        if until is None:
            return False
        if now >= until:
            del self._until[guild_id]
            return False
        return True

    def expires_at(self, guild_id: int) -> float | None:
        return self._until.get(guild_id)

    def expire(self, now: float) -> list[int]:
        """Remove and return guild ids whose lockdown has run out."""
        done = [g for g, until in self._until.items() if now >= until]
        for g in done:
            del self._until[g]
        return done


def is_new_account(created_ts: float, now: float, min_age_days: float) -> bool:
    """True if the account is younger than ``min_age_days`` (0 disables the check)."""
    return min_age_days > 0 and (now - created_ts) < min_age_days * 86400
