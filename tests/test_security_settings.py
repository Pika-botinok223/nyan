from __future__ import annotations

import dataclasses

import pytest

from nyan.security.settings import SCHEMA, SecuritySettings, SecurityStore


@pytest.mark.asyncio
async def test_defaults_and_persistence(db):
    store = SecurityStore(db)
    s = await store.get(1)
    assert s == SecuritySettings(guild_id=1)
    assert s.raid_enabled and s.scam_enabled and s.honeypot_enabled and s.spam_enabled

    await store.update(1, modlog_channel_id=42, raid_action="timeout", scam_enabled=False, raid_join_threshold=5)
    # A fresh store (new cache) must read the same values back from SQLite.
    again = await SecurityStore(db).get(1)
    assert again.modlog_channel_id == 42
    assert again.raid_action == "timeout"
    assert again.scam_enabled is False
    assert again.raid_join_threshold == 5
    assert again.honeypot_action == "ban"  # untouched default
    assert (await store.get(2)).modlog_channel_id is None  # guilds are isolated


@pytest.mark.asyncio
async def test_update_validation_and_clearing(db):
    store = SecurityStore(db)
    with pytest.raises(KeyError):
        await store.update(1, nonsense=1)
    with pytest.raises(ValueError):
        await store.update(1, raid_action="ban")
    with pytest.raises(ValueError):
        await store.update(1, honeypot_action="kick")
    await store.update(1, modlog_channel_id=7)
    s = await store.update(1, modlog_channel_id=None)
    assert s.modlog_channel_id is None


@pytest.mark.asyncio
async def test_domain_lists(db):
    store = SecurityStore(db)
    assert await store.domains(1) == (frozenset(), frozenset())
    await store.set_domain(1, "evil.com", "block")
    await store.set_domain(1, "discord.me", "allow")
    blocked, allowed = await SecurityStore(db).domains(1)
    assert blocked == {"evil.com"} and allowed == {"discord.me"}
    await store.set_domain(1, "evil.com", "allow")  # moves between lists
    assert await store.domains(1) == (frozenset(), frozenset({"evil.com", "discord.me"}))
    assert await store.remove_domain(1, "evil.com") is True
    assert await store.remove_domain(1, "evil.com") is False
    assert (await store.domains(2)) == (frozenset(), frozenset())
    with pytest.raises(ValueError):
        await store.set_domain(1, "x.com", "maybe")


@pytest.mark.asyncio
async def test_schema_matches_dataclass(db):
    await db.executescript(SCHEMA)
    cols = {r["name"] for r in await db.fetchall("PRAGMA table_info(sec_settings)")}
    assert cols == {f.name for f in dataclasses.fields(SecuritySettings)}
