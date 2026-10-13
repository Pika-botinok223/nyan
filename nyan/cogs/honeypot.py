from __future__ import annotations

import logging
import time
from typing import Literal, Optional

import discord
from discord import app_commands
from discord.ext import commands, tasks

from ..security.actions import safe_ban, safe_delete, safe_timeout
from ..security.guards import admin_check, protected_reason
from ..security.modlog import build_embed, excerpt, send_modlog
from ..security.settings import get_store
from ..security.spam import DuplicateSpamDetector

log = logging.getLogger("nyan.security.honeypot")

WARNING_TITLE = "DO NOT POST HERE"
WARNING_TEXT = (
    "**Do NOT post in this channel.** It is a trap for spam accounts.\n"
    "Automated bots and compromised accounts that post here are **banned automatically** "
    "and their recent messages are deleted.\n\n"
    "If you are a real person, just leave this channel alone. Nothing here is for you."
)


@app_commands.guild_only()
@app_commands.default_permissions(manage_guild=True)
class Honeypot(commands.GroupCog, group_name="honeypot", group_description="Spambot trap and duplicate-spam protection"):
    def __init__(self, bot: commands.Bot) -> None:
        self.bot = bot
        self.store = get_store(bot)
        self.spam = DuplicateSpamDetector()

    async def cog_load(self) -> None:
        await self.store.ensure()
        self.prune_spam.start()

    async def cog_unload(self) -> None:
        self.prune_spam.cancel()

    async def interaction_check(self, interaction: discord.Interaction) -> bool:
        return await admin_check(interaction)

    @tasks.loop(minutes=5)
    async def prune_spam(self) -> None:
        self.spam.prune(time.time())

    # ------------------------------------------------------------------ events

    @commands.Cog.listener()
    async def on_message(self, message: discord.Message) -> None:
        guild, author = message.guild, message.author
        if guild is None or author.bot or not isinstance(author, discord.Member):
            return
        settings = await self.store.get(guild.id)
        in_trap = settings.honeypot_enabled and settings.honeypot_channel_id == message.channel.id
        if not in_trap and not settings.spam_enabled:
            return
        protected = protected_reason(author, guild.me)
        if protected and not protected.startswith("role"):
            return  # owner / admin / moderator: never touched
        if in_trap:
            await self._trap(message, author, protected)
        else:
            await self._check_spam(message, author, protected)

    async def _trap(self, message: discord.Message, author: discord.Member, protected: Optional[str]) -> None:
        guild = message.guild
        assert guild is not None
        settings = await self.store.get(guild.id)
        await safe_delete(message)
        banned = False
        softban = settings.honeypot_action == "softban"
        if protected is None:
            banned = await safe_ban(
                author, "nyan honeypot: posted in the trap channel", settings.honeypot_delete_seconds, softban=softban
            )
        outcome = (("softbanned" if softban else "banned") if banned else f"NOT banned ({protected or 'missing permissions'})")
        embed = build_embed(
            "Honeypot triggered",
            f"{author.mention} (`{author}`) posted in {message.channel.mention}",
            level="alert",
            fields=[
                ("Action", f"{outcome}; purged up to {settings.honeypot_delete_seconds // 3600}h of messages"),
                ("Content", excerpt(message.content or "(no text / attachment only)")),
            ],
            user=author,
        )
        await send_modlog(guild, settings.modlog_channel_id, embed)

    async def _check_spam(self, message: discord.Message, author: discord.Member, protected: Optional[str]) -> None:
        guild = message.guild
        assert guild is not None
        key = message.content or "|".join(f"{a.filename}:{a.size}" for a in message.attachments)
        if not key:
            return
        settings = await self.store.get(guild.id)
        hit = self.spam.record(
            guild.id, author.id, message.channel.id, message.id, key, time.time(),
            settings.spam_channel_count, settings.spam_window_seconds,
        )  # fmt: skip
        if hit is None:
            return
        deleted = 0
        for channel_id, message_id in hit.messages:
            channel = guild.get_channel_or_thread(channel_id)
            if isinstance(channel, discord.abc.Messageable) and await safe_delete(channel.get_partial_message(message_id)):
                deleted += 1
        timed_out = False
        if protected is None:
            timed_out = await safe_timeout(author, settings.spam_timeout_minutes, "nyan: cross-channel duplicate spam")
        embed = build_embed(
            "Cross-channel spam blocked",
            f"{author.mention} posted the same message in **{hit.channel_count}** channels within {settings.spam_window_seconds}s",
            level="alert",
            fields=[
                ("Action", f"deleted {deleted}/{len(hit.messages)} messages; "
                           + (f"timed out {settings.spam_timeout_minutes}m" if timed_out else f"not timed out ({protected or 'failed'})")),
                ("Content", excerpt(hit.sample)),
            ],
            user=author,
        )  # fmt: skip
        await send_modlog(guild, settings.modlog_channel_id, embed)

    # ------------------------------------------------------------------ commands

    @app_commands.command(name="setup", description="Create (or designate) the honeypot channel")
    @app_commands.describe(channel="Existing channel to use; leave empty to create a new one")
    async def setup_cmd(self, interaction: discord.Interaction, channel: Optional[discord.TextChannel] = None) -> None:
        guild = interaction.guild
        assert guild is not None
        await interaction.response.defer(ephemeral=True)
        try:
            if channel is None:
                overwrites = {
                    guild.default_role: discord.PermissionOverwrite(
                        view_channel=True, send_messages=True, read_message_history=True
                    ),
                    guild.me: discord.PermissionOverwrite(
                        view_channel=True, send_messages=True, embed_links=True, manage_messages=True
                    ),
                }
                channel = await guild.create_text_channel(
                    "do-not-post-here",
                    overwrites=overwrites,
                    topic="Do NOT post here. Bots that post in this channel are banned.",
                    position=0,
                    reason=f"nyan honeypot setup by {interaction.user}",
                )
            await channel.send(
                embed=discord.Embed(title=WARNING_TITLE, description=WARNING_TEXT, color=discord.Color.red())
            )
        except (discord.Forbidden, discord.HTTPException) as exc:
            await interaction.followup.send(f"I could not set that up: `{exc}`. I need Manage Channels / Send Messages.")
            return
        await self.store.update(guild.id, honeypot_channel_id=channel.id, honeypot_enabled=True)
        notes = []
        me = guild.me.guild_permissions
        if not me.ban_members:
            notes.append("I am missing **Ban Members**; the trap cannot ban anyone yet.")
        if not channel.permissions_for(guild.me).manage_messages:
            notes.append(f"I cannot delete messages in {channel.mention} (Manage Messages).")
        await interaction.followup.send(
            f"Honeypot is live in {channel.mention}. Anyone without Manage Messages who posts there is "
            f"actioned. Tip: keep it near the top of the channel list so bots hit it first." + "".join(f"\n{n}" for n in notes)
        )

    @app_commands.command(name="disable", description="Stop using the honeypot channel (the channel itself is kept)")
    async def disable(self, interaction: discord.Interaction) -> None:
        assert interaction.guild is not None
        await self.store.update(interaction.guild.id, honeypot_channel_id=None)
        await interaction.response.send_message("Honeypot channel cleared. You can delete the channel if you like.", ephemeral=True)

    @app_commands.command(name="config", description="Configure what happens to honeypot victims")
    @app_commands.describe(
        action="ban, or softban (ban + immediate unban, just purges their messages)",
        purge_hours="Hours of the user's messages to delete (0-168)",
    )
    async def config(
        self,
        interaction: discord.Interaction,
        action: Optional[Literal["ban", "softban"]] = None,
        purge_hours: Optional[app_commands.Range[int, 0, 168]] = None,
    ) -> None:
        assert interaction.guild is not None
        changes: dict[str, object] = {}
        if action is not None:
            changes["honeypot_action"] = action
        if purge_hours is not None:
            changes["honeypot_delete_seconds"] = purge_hours * 3600
        s = await self.store.update(interaction.guild.id, **changes)
        chan = f"<#{s.honeypot_channel_id}>" if s.honeypot_channel_id else "not set"
        await interaction.response.send_message(
            f"Honeypot: channel {chan}, action **{s.honeypot_action}**, purge **{s.honeypot_delete_seconds // 3600}h**.",
            ephemeral=True,
        )

    @app_commands.command(name="spam", description="Configure the cross-channel duplicate spam detector")
    @app_commands.describe(
        channels="Distinct channels the same message must appear in",
        window_seconds="Time window",
        timeout_minutes="Timeout length for offenders",
    )
    async def spam_config(
        self,
        interaction: discord.Interaction,
        channels: Optional[app_commands.Range[int, 2, 10]] = None,
        window_seconds: Optional[app_commands.Range[int, 5, 300]] = None,
        timeout_minutes: Optional[app_commands.Range[int, 1, 40320]] = None,
    ) -> None:
        assert interaction.guild is not None
        changes = {
            "spam_channel_count": channels,
            "spam_window_seconds": window_seconds,
            "spam_timeout_minutes": timeout_minutes,
        }
        s = await self.store.update(interaction.guild.id, **{k: v for k, v in changes.items() if v is not None})
        await interaction.response.send_message(
            f"Spam detector: same message in **{s.spam_channel_count}** channels within **{s.spam_window_seconds}s** "
            f"-> delete + timeout **{s.spam_timeout_minutes}m**.",
            ephemeral=True,
        )


async def setup(bot: commands.Bot) -> None:
    await bot.add_cog(Honeypot(bot))
