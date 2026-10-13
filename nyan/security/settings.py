from __future__ import annotations

import dataclasses
from dataclasses import dataclass
from typing import Any

from ..db import Database

SCHEMA = """
CREATE TABLE IF NOT EXISTS sec_settings (
    guild_id INTEGER PRIMARY KEY,
    modlog_channel_id INTEGER,
    raid_enabled INTEGER NOT NULL DEFAULT 1,
    raid_join_threshold INTEGER NOT NULL DEFAULT 8,
    raid_window_seconds INTEGER NOT NULL DEFAULT 10,
    raid_action TEXT NOT NULL DEFAULT 'kick',
    raid_timeout_minutes INTEGER NOT NULL DEFAULT 60,
    raid_lockdown_minutes INTEGER NOT NULL DEFAULT 10,
    raid_flag_new_accounts INTEGER NOT NULL DEFAULT 0,
    raid_min_account_age_days INTEGER NOT NULL DEFAULT 3,
    scam_enabled INTEGER NOT NULL DEFAULT 1,
    scam_timeout_minutes INTEGER NOT NULL DEFAULT 60,
    honeypot_enabled INTEGER NOT NULL DEFAULT 1,
    honeypot_channel_id INTEGER,
    honeypot_action TEXT NOT NULL DEFAULT 'ban',
    honeypot_delete_seconds INTEGER NOT NULL DEFAULT 86400,
    spam_enabled INTEGER NOT NULL DEFAULT 1,
    spam_channel_count INTEGER NOT NULL DEFAULT 3,
    spam_window_seconds INTEGER NOT NULL DEFAULT 30,
    spam_timeout_minutes INTEGER NOT NULL DEFAULT 60
);
CREATE TABLE IF NOT EXISTS sec_domains (
    guild_id INTEGER NOT NULL,
    domain TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('block', 'allow')),
    PRIMARY KEY (guild_id, domain)
);
"""

MAX_TIMEOUT_MINUTES = 28 * 24 * 60  # Discord's hard cap on member timeouts
MAX_BAN_DELETE_SECONDS = 7 * 24 * 3600  # Discord's cap on ban message purge

MODULES = {  # module name -> enabled-flag field
    "antiraid": "raid_enabled",
    "antiscam": "scam_enabled",
    "honeypot": "honeypot_enabled",
    "spam": "spam_enabled",
}


@dataclass(frozen=True)
class SecuritySettings:
    guild_id: int
    modlog_channel_id: int | None = None
    raid_enabled: bool = True
    raid_join_threshold: int = 8
    raid_window_seconds: int = 10
    raid_action: str = "kick"  # kick | timeout
    raid_timeout_minutes: int = 60
    raid_lockdown_minutes: int = 10
    raid_flag_new_accounts: bool = False
    raid_min_account_age_days: int = 3
    scam_enabled: bool = True
    scam_timeout_minutes: int = 60
    honeypot_enabled: bool = True
    honeypot_channel_id: int | None = None
    honeypot_action: str = "ban"  # ban | softban
    honeypot_delete_seconds: int = 86400
    spam_enabled: bool = True
    spam_channel_count: int = 3
    spam_window_seconds: int = 30
    spam_timeout_minutes: int = 60


_FIELDS = {f.name: f for f in dataclasses.fields(SecuritySettings) if f.name != "guild_id"}
_BOOL_FIELDS = {n for n, f in _FIELDS.items() if f.type in (bool, "bool")}
_CHOICES = {"raid_action": {"kick", "timeout"}, "honeypot_action": {"ban", "softban"}}


def _from_row(row: Any) -> SecuritySettings:
    values: dict[str, Any] = {"guild_id": row["guild_id"]}
    for name in _FIELDS:
        value = row[name]
        values[name] = bool(value) if name in _BOOL_FIELDS else value
    return SecuritySettings(**values)


class SecurityStore:
    """Settings + domain lists, persisted in SQLite with a write-through in-memory cache."""

    def __init__(self, db: Database) -> None:
        self.db = db
        self._ready = False
        self._settings: dict[int, SecuritySettings] = {}
        self._domains: dict[int, tuple[frozenset[str], frozenset[str]]] = {}

    async def ensure(self) -> None:
        if not self._ready:
            await self.db.executescript(SCHEMA)
            self._ready = True

    async def get(self, guild_id: int) -> SecuritySettings:
        cached = self._settings.get(guild_id)
        if cached is not None:
            return cached
        await self.ensure()
        row = await self.db.fetchone("SELECT * FROM sec_settings WHERE guild_id = ?", (guild_id,))
        settings = _from_row(row) if row else SecuritySettings(guild_id=guild_id)
        self._settings[guild_id] = settings
        return settings

    async def update(self, guild_id: int, **changes: Any) -> SecuritySettings:
        if not changes:
            return await self.get(guild_id)
        for name, value in changes.items():
            if name not in _FIELDS:
                raise KeyError(f"unknown security setting: {name}")
            if name in _CHOICES and value not in _CHOICES[name]:
                raise ValueError(f"{name} must be one of {sorted(_CHOICES[name])}")
        await self.ensure()
        cols = list(changes)
        params = [int(v) if isinstance(v, bool) else v for v in changes.values()]
        sql = (
            f"INSERT INTO sec_settings (guild_id, {', '.join(cols)}) VALUES (?, {', '.join('?' * len(cols))}) "
            f"ON CONFLICT(guild_id) DO UPDATE SET {', '.join(f'{c} = excluded.{c}' for c in cols)}"
        )
        await self.db.execute(sql, [guild_id, *params])
        self._settings.pop(guild_id, None)
        return await self.get(guild_id)

    async def domains(self, guild_id: int) -> tuple[frozenset[str], frozenset[str]]:
        """Return ``(blocked, allowed)`` domain sets for a guild."""
        cached = self._domains.get(guild_id)
        if cached is not None:
            return cached
        await self.ensure()
        rows = await self.db.fetchall("SELECT domain, kind FROM sec_domains WHERE guild_id = ?", (guild_id,))
        blocked = frozenset(r["domain"] for r in rows if r["kind"] == "block")
        allowed = frozenset(r["domain"] for r in rows if r["kind"] == "allow")
        self._domains[guild_id] = (blocked, allowed)
        return blocked, allowed

    async def set_domain(self, guild_id: int, domain: str, kind: str) -> None:
        """Add ``domain`` to the block or allow list (it moves if it was on the other list)."""
        if kind not in ("block", "allow"):
            raise ValueError("kind must be 'block' or 'allow'")
        await self.ensure()
        await self.db.execute(
            "INSERT INTO sec_domains (guild_id, domain, kind) VALUES (?, ?, ?) "
            "ON CONFLICT(guild_id, domain) DO UPDATE SET kind = excluded.kind",
            (guild_id, domain, kind),
        )
        self._domains.pop(guild_id, None)

    async def remove_domain(self, guild_id: int, domain: str) -> bool:
        await self.ensure()
        removed = await self.db.execute("DELETE FROM sec_domains WHERE guild_id = ? AND domain = ?", (guild_id, domain))
        self._domains.pop(guild_id, None)
        return removed > 0


def get_store(bot: Any) -> SecurityStore:
    """Return the bot-wide shared store (created on first use) so all security cogs share one cache."""
    store = getattr(bot, "sec_store", None)
    if store is None:
        store = SecurityStore(bot.db)
        bot.sec_store = store
    return store
