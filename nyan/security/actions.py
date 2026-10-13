from __future__ import annotations

import logging
from datetime import timedelta

import discord

from .settings import MAX_BAN_DELETE_SECONDS, MAX_TIMEOUT_MINUTES

log = logging.getLogger("nyan.security")

# Every helper swallows Forbidden/HTTPException (logging them) and returns whether it worked.


async def safe_delete(message: discord.Message | discord.PartialMessage, reason: str = "") -> bool:
    try:
        await message.delete()
        return True
    except discord.NotFound:
        return True  # already gone
    except (discord.Forbidden, discord.HTTPException) as exc:
        log.warning("cannot delete message %s: %s", message.id, exc)
        return False


async def safe_timeout(member: discord.Member, minutes: int, reason: str) -> bool:
    minutes = max(1, min(int(minutes), MAX_TIMEOUT_MINUTES))
    try:
        await member.timeout(timedelta(minutes=minutes), reason=reason[:512])
        return True
    except (discord.Forbidden, discord.HTTPException) as exc:
        log.warning("cannot timeout %s in %s: %s", member.id, member.guild.id, exc)
        return False


async def safe_kick(member: discord.Member, reason: str) -> bool:
    try:
        await member.kick(reason=reason[:512])
        return True
    except (discord.Forbidden, discord.HTTPException) as exc:
        log.warning("cannot kick %s in %s: %s", member.id, member.guild.id, exc)
        return False


async def safe_ban(member: discord.Member, reason: str, delete_seconds: int = 86400, *, softban: bool = False) -> bool:
    """Ban (purging ``delete_seconds`` of message history); with ``softban`` the user is unbanned straight away."""
    guild = member.guild
    try:
        await guild.ban(member, reason=reason[:512], delete_message_seconds=max(0, min(int(delete_seconds), MAX_BAN_DELETE_SECONDS)))
    except (discord.Forbidden, discord.HTTPException) as exc:
        log.warning("cannot ban %s in %s: %s", member.id, guild.id, exc)
        return False
    if softban:
        try:
            await guild.unban(member, reason="softban: " + reason[:480])
        except (discord.Forbidden, discord.HTTPException) as exc:
            log.warning("banned but cannot unban %s in %s: %s", member.id, guild.id, exc)
    return True
