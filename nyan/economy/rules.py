"""Pure economy rules (no I/O) so they are trivially unit-testable."""

from __future__ import annotations

import random
from collections.abc import Sequence

DAILY_COOLDOWN = 24 * 3600
DAILY_STREAK_WINDOW = 48 * 3600  # claim again within this window to keep the streak
WORK_COOLDOWN = 3600

DAILY_BASE = 100
DAILY_STREAK_BONUS = 25
DAILY_MAX = 400

WORK_MIN = 20
WORK_MAX = 120

MAX_AMOUNT = 1_000_000  # cap for bets / transfers / admin adjustments
MAX_BALANCE = 10**15  # keeps us far away from SQLite's int64 limit

WORK_FLAVORS: tuple[str, ...] = (
    "You chased a laser pointer for tourists at the pier.",
    "You knocked a very expensive vase off a shelf... on purpose, for a film crew.",
    "You worked a shift at the tuna cannery.",
    "You guarded a warehouse from mice all night.",
    "You were a professional lap warmer at a busy office.",
    "You modelled for a catnip commercial.",
    "You delivered fish by paw-cycle across town.",
    "You gave a motivational purr-sentation to a startup.",
    "You sold hand-knitted yarn balls at the farmers' market.",
    "You taught a dog how to sit. It took all day.",
)

# (symbol, weight, payout multiplier for three of a kind)
SLOT_SYMBOLS: tuple[tuple[str, int, int], ...] = (
    ("🍒", 30, 4),
    ("🍋", 25, 6),
    ("🔔", 20, 10),
    ("⭐", 15, 15),
    ("💎", 8, 30),
    ("🐱", 2, 100),
)
_MULTIPLIERS = {s: m for s, _, m in SLOT_SYMBOLS}


def daily_reward(streak: int) -> int:
    """Reward for claiming on a given streak day (1 = first day)."""
    streak = max(1, streak)
    return min(DAILY_BASE + DAILY_STREAK_BONUS * (streak - 1), DAILY_MAX)


def next_streak(previous_streak: int, last_claim: float, now: float) -> int:
    """Streak after claiming at ``now``; resets if the previous claim was too long ago."""
    if last_claim > 0 and previous_streak > 0 and now - last_claim <= DAILY_STREAK_WINDOW:
        return previous_streak + 1
    return 1


def spin_slots(rng: random.Random | None = None) -> list[str]:
    rng = rng or random
    symbols = [s for s, _, _ in SLOT_SYMBOLS]
    weights = [w for _, w, _ in SLOT_SYMBOLS]
    return rng.choices(symbols, weights=weights, k=3)


def slots_payout(reels: Sequence[str], bet: int) -> int:
    """Total amount returned to the player (the bet is *not* refunded on top of this).

    Three of a kind pays ``bet * multiplier``; any pair returns 75% of the bet; otherwise 0.
    """
    if len(reels) != 3:
        raise ValueError("slots need exactly 3 reels")
    a, b, c = reels
    if a == b == c:
        return bet * _MULTIPLIERS[a]
    if a == b or b == c or a == c:
        return bet * 3 // 4
    return 0


def coinflip_net(bet: int, won: bool) -> int:
    return bet if won else -bet
