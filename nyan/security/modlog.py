from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

import discord

log = logging.getLogger("nyan.security")

COLORS = {
    "info": discord.Color.blurple(),
    "warn": discord.Color.orange(),
    "alert": discord.Color.red(),
    "ok": discord.Color.green(),
}


def build_embed(
    title: str,
    description: str = "",
    *,
    level: str = "warn",
    fields: list[tuple[str, str]] | None = None,
    user: Any = None,
) -> discord.Embed:
    """Build a modlog embed. Pure (no network); field values are clipped to Discord's limits."""
    embed = discord.Embed(
        title=title[:256],
        description=description[:4000],
        color=COLORS.get(level, COLORS["warn"]),
        timestamp=datetime.now(timezone.utc),
    )
    for name, value in (fields or [])[:10]:
        embed.add_field(name=name[:256], value=(value or "​")[:1024], inline=False)
    if user is not None:
        embed.set_footer(text=f"User ID: {user.id}")
    return embed


async def send_modlog(guild: discord.Guild, channel_id: int | None, embed: discord.Embed) -> bool:
    """Post ``embed`` to the configured modlog channel. Never raises; returns whether it was delivered."""
    if not channel_id:
        return False
    channel = guild.get_channel(channel_id)
    if channel is None or not isinstance(channel, discord.abc.Messageable):
        log.warning("modlog channel %s missing in guild %s", channel_id, guild.id)
        return False
    try:
        await channel.send(embed=embed, allowed_mentions=discord.AllowedMentions.none())
        return True
    except (discord.Forbidden, discord.HTTPException) as exc:
        log.warning("cannot write to modlog %s in guild %s: %s", channel_id, guild.id, exc)
        return False


def excerpt(content: str, limit: int = 500) -> str:
    """Defang links and break code fences so quoted spam in the modlog is inert and cannot be clicked."""
    text = content.replace("```", "'''").replace("http", "hxxp").replace("@", "@​")
    return f"```\n{text[:limit]}\n```"
