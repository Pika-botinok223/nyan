from __future__ import annotations

import time

import discord
from discord import app_commands
from discord.ext import commands

from ..security.guards import admin_check
from ..security.settings import MODULES, SecuritySettings, get_store


def _on(flag: bool) -> str:
    return "enabled" if flag else "disabled"


def status_embed(guild: discord.Guild, s: SecuritySettings, lockdown: bool = False) -> discord.Embed:
    embed = discord.Embed(title=f"Security status: {guild.name}", color=discord.Color.blurple())
    embed.add_field(name="Modlog", value=f"<#{s.modlog_channel_id}>" if s.modlog_channel_id else "not set", inline=False)
    embed.add_field(
        name=f"Anti-raid ({_on(s.raid_enabled)})",
        value=(
            f"Trigger: {s.raid_join_threshold} joins / {s.raid_window_seconds}s -> lockdown for {s.raid_lockdown_minutes}m"
            f"{' (ACTIVE now)' if lockdown else ''}\n"
            f"Action on joiners: {s.raid_action}"
            f"{f' ({s.raid_timeout_minutes}m)' if s.raid_action == 'timeout' else ''}\n"
            f"Flag new accounts: {f'< {s.raid_min_account_age_days}d old' if s.raid_flag_new_accounts else 'off'}"
        ),
        inline=False,
    )
    embed.add_field(
        name=f"Anti-scam ({_on(s.scam_enabled)})",
        value=f"Delete message + timeout {s.scam_timeout_minutes}m",
        inline=False,
    )
    pot = f"<#{s.honeypot_channel_id}>" if s.honeypot_channel_id else "no channel (run `/honeypot setup`)"
    embed.add_field(
        name=f"Honeypot ({_on(s.honeypot_enabled)})",
        value=f"Channel: {pot}\nAction: {s.honeypot_action}, purge {s.honeypot_delete_seconds // 3600}h of messages",
        inline=False,
    )
    embed.add_field(
        name=f"Cross-channel spam ({_on(s.spam_enabled)})",
        value=(
            f"Same message in {s.spam_channel_count}+ channels / {s.spam_window_seconds}s -> "
            f"delete + timeout {s.spam_timeout_minutes}m"
        ),
        inline=False,
    )
    return embed


@app_commands.guild_only()
@app_commands.default_permissions(manage_guild=True)
class SecurityCog(commands.GroupCog, group_name="security", group_description="Configure nyan's security modules"):
    def __init__(self, bot: commands.Bot) -> None:
        self.bot = bot
        self.store = get_store(bot)

    async def cog_load(self) -> None:
        await self.store.ensure()

    async def interaction_check(self, interaction: discord.Interaction) -> bool:
        return await admin_check(interaction)

    @app_commands.command(name="modlog", description="Set (or clear, if no channel is given) the channel for security logs")
    @app_commands.describe(channel="Channel to post security alerts in; leave empty to disable logging")
    async def modlog(self, interaction: discord.Interaction, channel: discord.TextChannel | None = None) -> None:
        assert interaction.guild is not None
        if channel is not None:
            me = interaction.guild.me
            perms = channel.permissions_for(me)
            if not (perms.view_channel and perms.send_messages and perms.embed_links):
                await interaction.response.send_message(
                    f"I need View Channel, Send Messages and Embed Links in {channel.mention} first.", ephemeral=True
                )
                return
        await self.store.update(interaction.guild.id, modlog_channel_id=channel.id if channel else None)
        await interaction.response.send_message(
            f"Security alerts will go to {channel.mention}." if channel else "Modlog cleared; actions are no longer logged.",
            ephemeral=True,
        )

    @app_commands.command(name="toggle", description="Enable or disable a security module")
    @app_commands.describe(module="Which module", enabled="Turn it on or off")
    @app_commands.choices(
        module=[
            app_commands.Choice(name="Anti-raid", value="antiraid"),
            app_commands.Choice(name="Anti-scam", value="antiscam"),
            app_commands.Choice(name="Honeypot", value="honeypot"),
            app_commands.Choice(name="Cross-channel spam detector", value="spam"),
        ]
    )
    async def toggle(self, interaction: discord.Interaction, module: app_commands.Choice[str], enabled: bool) -> None:
        assert interaction.guild is not None
        await self.store.update(interaction.guild.id, **{MODULES[module.value]: enabled})
        await interaction.response.send_message(f"**{module.name}** is now {_on(enabled)}.", ephemeral=True)

    @app_commands.command(name="status", description="Show the current security configuration")
    async def status(self, interaction: discord.Interaction) -> None:
        assert interaction.guild is not None
        settings = await self.store.get(interaction.guild.id)
        raid = self.bot.get_cog("AntiRaid")
        locked = bool(raid and raid.lockdown.is_active(interaction.guild.id, time.time()))  # type: ignore[attr-defined]
        await interaction.response.send_message(embed=status_embed(interaction.guild, settings, locked), ephemeral=True)


async def setup(bot: commands.Bot) -> None:
    await bot.add_cog(SecurityCog(bot))
