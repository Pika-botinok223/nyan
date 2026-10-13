"""Async repository for the per-guild economy. All money movement is a single SQL statement."""

from __future__ import annotations

import random
import sqlite3
import time
from dataclasses import dataclass

from ..db import Database
from . import rules

SCHEMA = """
CREATE TABLE IF NOT EXISTS eco_config (
    guild_id INTEGER PRIMARY KEY,
    currency_name TEXT NOT NULL DEFAULT 'nyancoins',
    currency_emoji TEXT NOT NULL DEFAULT '🪙'
);
CREATE TABLE IF NOT EXISTS eco_users (
    guild_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    balance INTEGER NOT NULL DEFAULT 0 CHECK (balance BETWEEN 0 AND 1000000000000000),
    last_daily REAL NOT NULL DEFAULT 0,
    daily_streak INTEGER NOT NULL DEFAULT 0,
    last_work REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id)
);
CREATE INDEX IF NOT EXISTS eco_users_leaderboard ON eco_users (guild_id, balance DESC);
CREATE TABLE IF NOT EXISTS eco_shop (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id INTEGER NOT NULL,
    name TEXT NOT NULL COLLATE NOCASE,
    price INTEGER NOT NULL CHECK (price > 0),
    role_id INTEGER,
    UNIQUE (guild_id, name)
);
CREATE TABLE IF NOT EXISTS eco_inventory (
    guild_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    item_name TEXT NOT NULL COLLATE NOCASE,
    quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
    PRIMARY KEY (guild_id, user_id, item_name)
);
"""

DEFAULT_NAME = "nyancoins"
DEFAULT_EMOJI = "🪙"
MAX_SHOP_ITEMS = 25


class EconomyError(Exception):
    """Base class; ``str(error)`` is safe to show to users."""


class InvalidAmount(EconomyError):
    pass


class InsufficientFunds(EconomyError):
    pass


class OnCooldown(EconomyError):
    def __init__(self, remaining: float, available_at: float) -> None:
        self.remaining = remaining
        self.available_at = available_at
        super().__init__(f"Try again in {int(remaining // 3600)}h {int(remaining % 3600 // 60)}m.")


@dataclass(frozen=True)
class CurrencyConfig:
    name: str = DEFAULT_NAME
    emoji: str = DEFAULT_EMOJI

    def fmt(self, amount: int) -> str:
        return f"{self.emoji} **{amount:,}** {self.name}"


@dataclass(frozen=True)
class DailyResult:
    reward: int
    streak: int
    balance: int


@dataclass(frozen=True)
class WorkResult:
    payout: int
    flavor: str
    balance: int


@dataclass(frozen=True)
class ShopItem:
    id: int
    guild_id: int
    name: str
    price: int
    role_id: int | None


def _item(row: sqlite3.Row) -> ShopItem:
    return ShopItem(row["id"], row["guild_id"], row["name"], row["price"], row["role_id"])


def _check_amount(amount: int) -> None:
    if amount <= 0:
        raise InvalidAmount("Amount must be greater than zero.")
    if amount > rules.MAX_AMOUNT:
        raise InvalidAmount(f"Amount can be at most {rules.MAX_AMOUNT:,}.")


class EconomyRepo:
    def __init__(self, db: Database) -> None:
        self.db = db

    async def setup(self) -> None:
        await self.db.executescript(SCHEMA)

    # --- config -----------------------------------------------------------------------------

    async def get_config(self, guild_id: int) -> CurrencyConfig:
        row = await self.db.fetchone("SELECT currency_name, currency_emoji FROM eco_config WHERE guild_id = ?", (guild_id,))
        return CurrencyConfig(row["currency_name"], row["currency_emoji"]) if row else CurrencyConfig()

    async def set_config(self, guild_id: int, name: str | None = None, emoji: str | None = None) -> CurrencyConfig:
        current = await self.get_config(guild_id)
        new_name = (name or current.name).strip()
        new_emoji = (emoji or current.emoji).strip()
        if not 1 <= len(new_name) <= 32:
            raise EconomyError("Currency name must be 1-32 characters.")
        if not 1 <= len(new_emoji) <= 64:
            raise EconomyError("Currency emoji must be 1-64 characters.")
        await self.db.execute(
            "INSERT INTO eco_config (guild_id, currency_name, currency_emoji) VALUES (?, ?, ?) "
            "ON CONFLICT(guild_id) DO UPDATE SET currency_name = excluded.currency_name, "
            "currency_emoji = excluded.currency_emoji",
            (guild_id, new_name, new_emoji),
        )
        return CurrencyConfig(new_name, new_emoji)

    # --- balances ---------------------------------------------------------------------------

    async def _ensure(self, guild_id: int, user_id: int) -> None:
        await self.db.execute("INSERT OR IGNORE INTO eco_users (guild_id, user_id) VALUES (?, ?)", (guild_id, user_id))

    async def balance(self, guild_id: int, user_id: int) -> int:
        row = await self.db.fetchone("SELECT balance FROM eco_users WHERE guild_id = ? AND user_id = ?", (guild_id, user_id))
        return row["balance"] if row else 0

    async def adjust(self, guild_id: int, user_id: int, delta: int) -> int | None:
        """Atomically add ``delta`` (may be negative). Returns the new balance, or ``None`` if it
        would drop below zero (or exceed the balance ceiling) - in which case nothing changes."""
        await self._ensure(guild_id, user_id)
        changed = await self.db.execute(
            "UPDATE eco_users SET balance = balance + ? WHERE guild_id = ? AND user_id = ? "
            "AND balance + ? >= 0 AND balance + ? <= ?",
            (delta, guild_id, user_id, delta, delta, rules.MAX_BALANCE),
        )
        return await self.balance(guild_id, user_id) if changed else None

    async def add(self, guild_id: int, user_id: int, amount: int) -> int:
        _check_amount(amount)
        new = await self.adjust(guild_id, user_id, amount)
        if new is None:
            raise EconomyError("That balance is already as high as it can go.")
        return new

    async def take(self, guild_id: int, user_id: int, amount: int) -> int:
        """Admin removal; clamps at zero. Returns the new balance."""
        _check_amount(amount)
        await self._ensure(guild_id, user_id)
        await self.db.execute(
            "UPDATE eco_users SET balance = MAX(balance - ?, 0) WHERE guild_id = ? AND user_id = ?",
            (amount, guild_id, user_id),
        )
        return await self.balance(guild_id, user_id)

    async def wager(self, guild_id: int, user_id: int, bet: int, net: int) -> int:
        """Settle a gamble: atomically apply ``net`` (win = +, loss = -) given the player staked ``bet``."""
        _check_amount(bet)
        await self._ensure(guild_id, user_id)
        # The player must be able to cover the stake, not just the loss: otherwise a broke player wins free money.
        changed = await self.db.execute(
            "UPDATE eco_users SET balance = balance + ? WHERE guild_id = ? AND user_id = ? "
            "AND balance >= ? AND balance + ? BETWEEN 0 AND ?",
            (net, guild_id, user_id, bet, net, rules.MAX_BALANCE),
        )
        if not changed:
            raise InsufficientFunds("You don't have enough to place that bet.")
        return await self.balance(guild_id, user_id)

    async def transfer(self, guild_id: int, sender_id: int, receiver_id: int, amount: int) -> tuple[int, int]:
        """Move money in ONE statement so it is all-or-nothing. Returns (sender, receiver) balances."""
        if sender_id == receiver_id:
            raise InvalidAmount("You can't pay yourself.")
        _check_amount(amount)
        await self._ensure(guild_id, sender_id)
        await self._ensure(guild_id, receiver_id)
        # One statement: the CHECK (balance BETWEEN 0 AND MAX) constraint makes SQLite abort and roll back
        # the whole UPDATE if the sender would go negative or the receiver would overflow.
        try:
            changed = await self.db.execute(
                "UPDATE eco_users SET balance = balance + CASE user_id WHEN ? THEN -? ELSE ? END "
                "WHERE guild_id = ? AND user_id IN (?, ?)",
                (sender_id, amount, amount, guild_id, sender_id, receiver_id),
            )
        except sqlite3.IntegrityError:
            raise InsufficientFunds("You don't have enough to send that much.") from None
        if changed != 2:
            raise EconomyError("Transfer failed, please try again.")
        return await self.balance(guild_id, sender_id), await self.balance(guild_id, receiver_id)

    async def leaderboard(self, guild_id: int, limit: int = 10) -> list[tuple[int, int]]:
        rows = await self.db.fetchall(
            "SELECT user_id, balance FROM eco_users WHERE guild_id = ? AND balance > 0 "
            "ORDER BY balance DESC, user_id LIMIT ?",
            (guild_id, limit),
        )
        return [(r["user_id"], r["balance"]) for r in rows]

    # --- cooldown rewards -------------------------------------------------------------------

    async def _cooldown_row(self, guild_id: int, user_id: int) -> sqlite3.Row:
        await self._ensure(guild_id, user_id)
        row = await self.db.fetchone("SELECT * FROM eco_users WHERE guild_id = ? AND user_id = ?", (guild_id, user_id))
        assert row is not None
        return row

    async def claim_daily(self, guild_id: int, user_id: int, now: float | None = None) -> DailyResult:
        now = time.time() if now is None else now
        row = await self._cooldown_row(guild_id, user_id)
        last = row["last_daily"]
        if now - last < rules.DAILY_COOLDOWN:
            raise OnCooldown(rules.DAILY_COOLDOWN - (now - last), last + rules.DAILY_COOLDOWN)
        streak = rules.next_streak(row["daily_streak"], last, now)
        reward = rules.daily_reward(streak)
        # compare-and-set on last_daily so two simultaneous claims can't both succeed
        changed = await self.db.execute(
            "UPDATE eco_users SET balance = balance + ?, last_daily = ?, daily_streak = ? "
            "WHERE guild_id = ? AND user_id = ? AND last_daily = ?",
            (reward, now, streak, guild_id, user_id, last),
        )
        if not changed:
            raise OnCooldown(rules.DAILY_COOLDOWN, now + rules.DAILY_COOLDOWN)
        return DailyResult(reward, streak, await self.balance(guild_id, user_id))

    async def claim_work(
        self, guild_id: int, user_id: int, now: float | None = None, rng: random.Random | None = None
    ) -> WorkResult:
        now = time.time() if now is None else now
        rng = rng or random.Random()
        row = await self._cooldown_row(guild_id, user_id)
        last = row["last_work"]
        if now - last < rules.WORK_COOLDOWN:
            raise OnCooldown(rules.WORK_COOLDOWN - (now - last), last + rules.WORK_COOLDOWN)
        payout = rng.randint(rules.WORK_MIN, rules.WORK_MAX)
        flavor = rng.choice(rules.WORK_FLAVORS)
        changed = await self.db.execute(
            "UPDATE eco_users SET balance = balance + ?, last_work = ? WHERE guild_id = ? AND user_id = ? AND last_work = ?",
            (payout, now, guild_id, user_id, last),
        )
        if not changed:
            raise OnCooldown(rules.WORK_COOLDOWN, now + rules.WORK_COOLDOWN)
        return WorkResult(payout, flavor, await self.balance(guild_id, user_id))

    # --- shop -------------------------------------------------------------------------------

    async def add_item(self, guild_id: int, name: str, price: int, role_id: int | None = None) -> ShopItem:
        name = name.strip()
        if not 1 <= len(name) <= 50:
            raise EconomyError("Item names must be 1-50 characters.")
        _check_amount(price)
        count = await self.db.fetchone("SELECT COUNT(*) AS n FROM eco_shop WHERE guild_id = ?", (guild_id,))
        if count and count["n"] >= MAX_SHOP_ITEMS:
            raise EconomyError(f"A shop can hold at most {MAX_SHOP_ITEMS} items.")
        try:
            await self.db.execute(
                "INSERT INTO eco_shop (guild_id, name, price, role_id) VALUES (?, ?, ?, ?)",
                (guild_id, name, price, role_id),
            )
        except sqlite3.IntegrityError:
            raise EconomyError(f"There's already an item called **{name}**.") from None
        item = await self.get_item(guild_id, name)
        assert item is not None
        return item

    async def remove_item(self, guild_id: int, name: str) -> bool:
        return bool(await self.db.execute("DELETE FROM eco_shop WHERE guild_id = ? AND name = ?", (guild_id, name.strip())))

    async def get_item(self, guild_id: int, name: str) -> ShopItem | None:
        row = await self.db.fetchone("SELECT * FROM eco_shop WHERE guild_id = ? AND name = ?", (guild_id, name.strip()))
        return _item(row) if row else None

    async def list_items(self, guild_id: int) -> list[ShopItem]:
        rows = await self.db.fetchall("SELECT * FROM eco_shop WHERE guild_id = ? ORDER BY price, name", (guild_id,))
        return [_item(r) for r in rows]

    async def buy(self, guild_id: int, user_id: int, name: str) -> tuple[ShopItem, int]:
        """Debit the price (conditional single UPDATE) and add the item to the inventory."""
        item = await self.get_item(guild_id, name)
        if item is None:
            raise EconomyError(f"There's no item called **{name.strip()}** in the shop.")
        new_balance = await self.adjust(guild_id, user_id, -item.price)
        if new_balance is None:
            raise InsufficientFunds(f"**{item.name}** costs {item.price:,} and you can't afford it.")
        try:
            await self.db.execute(
                "INSERT INTO eco_inventory (guild_id, user_id, item_name) VALUES (?, ?, ?) "
                "ON CONFLICT(guild_id, user_id, item_name) DO UPDATE SET quantity = quantity + 1",
                (guild_id, user_id, item.name),
            )
        except Exception:
            await self.adjust(guild_id, user_id, item.price)
            raise
        return item, new_balance

    async def refund_purchase(self, guild_id: int, user_id: int, item: ShopItem) -> int:
        """Undo a purchase (e.g. the role grant failed): remove one copy and return the price."""
        where = "WHERE guild_id = ? AND user_id = ? AND item_name = ?"
        params = (guild_id, user_id, item.name)
        await self.db.execute(f"DELETE FROM eco_inventory {where} AND quantity <= 1", params)
        await self.db.execute(f"UPDATE eco_inventory SET quantity = quantity - 1 {where}", params)
        new = await self.adjust(guild_id, user_id, item.price)
        return new if new is not None else await self.balance(guild_id, user_id)

    async def inventory(self, guild_id: int, user_id: int) -> list[tuple[str, int]]:
        rows = await self.db.fetchall(
            "SELECT item_name, quantity FROM eco_inventory WHERE guild_id = ? AND user_id = ? ORDER BY item_name",
            (guild_id, user_id),
        )
        return [(r["item_name"], r["quantity"]) for r in rows]
