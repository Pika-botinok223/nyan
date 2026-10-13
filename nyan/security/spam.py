from __future__ import annotations

import re
from collections import OrderedDict, deque
from dataclasses import dataclass
from difflib import SequenceMatcher

MAX_TRACKED_USERS = 5000
MAX_MESSAGES_PER_USER = 20
MIN_CONTENT_LEN = 5
SIMILARITY = 0.9

_WS = re.compile(r"\s+")


def normalize(content: str) -> str:
    return _WS.sub(" ", content).strip().lower()


def similar(a: str, b: str) -> bool:
    if a == b:
        return True
    if not a or not b or abs(len(a) - len(b)) > max(len(a), len(b)) * (1 - SIMILARITY):
        return False
    matcher = SequenceMatcher(None, a, b, autojunk=False)
    return matcher.real_quick_ratio() >= SIMILARITY and matcher.ratio() >= SIMILARITY


@dataclass(frozen=True)
class SpamHit:
    """A detected cross-channel duplicate burst. ``messages`` is ``(channel_id, message_id)`` pairs."""

    messages: tuple[tuple[int, int], ...]
    channel_count: int
    sample: str


class DuplicateSpamDetector:
    """Flags one user posting the same/similar message in >= N distinct channels within a window."""

    def __init__(self, max_users: int = MAX_TRACKED_USERS) -> None:
        self._seen: OrderedDict[tuple[int, int], deque[tuple[float, int, int, str]]] = OrderedDict()
        self._max_users = max_users

    def record(
        self,
        guild_id: int,
        user_id: int,
        channel_id: int,
        message_id: int,
        content: str,
        now: float,
        min_channels: int = 3,
        window_seconds: float = 30,
    ) -> SpamHit | None:
        text = normalize(content)
        if len(text) < MIN_CONTENT_LEN:
            return None
        key = (guild_id, user_id)
        entries = self._seen.get(key)
        if entries is None:
            entries = self._seen[key] = deque(maxlen=MAX_MESSAGES_PER_USER)
            while len(self._seen) > self._max_users:
                self._seen.popitem(last=False)
        else:
            self._seen.move_to_end(key)

        cutoff = now - window_seconds
        while entries and entries[0][0] < cutoff:
            entries.popleft()
        entries.append((now, channel_id, message_id, text))

        matches = [e for e in entries if similar(e[3], text)]
        channels = {e[1] for e in matches}
        if len(channels) < min_channels:
            return None
        # Clear the matched messages so the same burst does not trigger twice.
        ids = {e[2] for e in matches}
        remaining = [e for e in entries if e[2] not in ids]
        entries.clear()
        entries.extend(remaining)
        return SpamHit(tuple((e[1], e[2]) for e in matches), len(channels), text[:200])

    def prune(self, now: float, max_age: float = 300) -> None:
        """Drop users with no recent messages (call periodically)."""
        for key in [k for k, d in self._seen.items() if not d or now - d[-1][0] > max_age]:
            del self._seen[key]
