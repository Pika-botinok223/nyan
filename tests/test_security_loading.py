from __future__ import annotations

import discord
import pytest
from discord.ext import commands

from nyan.db import Database
from nyan.cogs import antiraid, antiscam, honeypot, security


@pytest.mark.asyncio
async def test_cogs_register_guarded_groups(db: Database):
    bot = commands.Bot(command_prefix="!", intents=discord.Intents.none())
    bot.db = db  # type: ignore[attr-defined]
    for module in (security, antiraid, antiscam, honeypot):
        await module.setup(bot)
    groups = {c.name: c for c in bot.tree.get_commands()}
    assert set(groups) == {"security", "antiraid", "antiscam", "honeypot"}
    for group in groups.values():
        assert group.guild_only
        assert group.default_permissions is not None and group.default_permissions.manage_guild
    names = {c.qualified_name for c in bot.tree.walk_commands()}
    assert {"security modlog", "security toggle", "security status", "antiraid lockdown", "antiraid config",
            "antiscam block", "antiscam allow", "antiscam list", "honeypot setup", "honeypot spam"} <= names
    for cog in ("AntiRaid", "Honeypot"):
        await bot.remove_cog(cog)  # stops background loops
    await bot.close()
