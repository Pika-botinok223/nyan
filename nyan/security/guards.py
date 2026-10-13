from __future__ import annotations

from typing import Any


def protected_reason(member: Any, me: Any, *, check_mod: bool = True) -> str | None:
    """Why the bot must NOT take action against ``member`` (None means it is fair game).

    Works on ``discord.Member``-like objects. ``me`` is the bot's own member in that guild.
    """
    guild = member.guild
    if member.id == getattr(guild, "owner_id", None):
        return "server owner"
    if me is None:
        return "bot member unavailable"
    if member.id == me.id:
        return "myself"
    perms = member.guild_permissions
    if perms.administrator:
        return "administrator"
    if check_mod and perms.manage_messages:
        return "moderator (manage messages)"
    if member.top_role >= me.top_role:
        return "role is equal to or higher than mine"
    return None


async def admin_check(interaction: Any) -> bool:
    """Runtime backstop for ``default_permissions`` (server admins can re-map those): require Manage Server."""
    user = interaction.user
    if interaction.guild is not None and getattr(user, "guild_permissions", None) and user.guild_permissions.manage_guild:
        return True
    msg = "You need the **Manage Server** permission to use this."
    if interaction.response.is_done():
        await interaction.followup.send(msg, ephemeral=True)
    else:
        await interaction.response.send_message(msg, ephemeral=True)
    return False
