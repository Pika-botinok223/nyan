from __future__ import annotations

import logging
import time
from typing import Literal, Optional

import discord
from discord import app_commands
from discord.ext import commands, tasks

from ..security.actions import safe_kick, safe_timeout
from ..security.guards import admin_check, protected_reason
from ..security.modlog import build_embed, send_modlog
from ..security.raid import JoinRateDetector, LockdownState, is_new_account
from ..security.settings import get_store

log = logging.getLogger("nyan.security.antiraid")


@app_commands.guild_only()
@app_commands.default_permissions(manage_guild=True)
class AntiRaid(commands.GroupCog, group_name="antiraid", group_description="Join-rate raid protection"):
    def __init__(self, bot: commands.Bot) -> None:
        self.bot = bot
        self.store = get_store(bot)
        self.detector = JoinRateDetector()
        self.lockdown = LockdownState()
        self.actioned: dict[int, int] = {}  # guild_id -> members dealt with during the current lockdown

    async def cog_load(self) -> None:
        await self.store.ensure()
        self.expire_lockdowns.start()

    async def cog_unload(self) -> None:
        self.expire_lockdowns.cancel()

    async def interaction_check(self, interaction: discord.Interaction) -> bool:
        return await admin_check(interaction)

    # ------------------------------------------------------------------ helpers

    async def _log(self, guild: discord.Guild, title: str, desc: str, level: str = "alert", **kw) -> None:
        settings = await self.store.get(guild.id)
        await send_modlog(guild, settings.modlog_channel_id, build_embed(title, desc, level=level, **kw))

    async def _handle_joiner(self, member: discord.Member, reason: str) -> bool:
        """Kick or time out a joiner during lockdown. Returns True if an action succeeded."""
        settings = await self.store.get(member.guild.id)
        me = member.guild.me
        if protected_reason(member, me, check_mod=False):
            return False
        if settings.raid_action == "timeout":
            ok = await safe_timeout(member, settings.raid_timeout_minutes, reason)
        else:
            try:
                await member.send(f"**{member.guild.name}** is temporarily locked down. Please try joining again later.")
            except (discord.Forbidden, discord.HTTPException):
                pass
            ok = await safe_kick(member, reason)
        if ok:
            self.actioned[member.guild.id] = self.actioned.get(member.guild.id, 0) + 1
        log.info("raid action %s on %s in %s: %s", settings.raid_action, member.id, member.guild.id, ok)
        return ok

    async def start_lockdown(self, guild: discord.Guild, minutes: int, why: str) -> None:
        expires = self.lockdown.start(guild.id, time.time(), minutes * 60)
        self.actioned[guild.id] = 0
        settings = await self.store.get(guild.id)
        verb = "timed out" if settings.raid_action == "timeout" else "kicked"
        await self._log(
            guild,
            "Lockdown started",
            f"{why}\nNew joins will be **{verb}** until <t:{int(expires)}:T> (<t:{int(expires)}:R>).",
        )

    # ------------------------------------------------------------------ events

    @commands.Cog.listener()
    async def on_member_join(self, member: discord.Member) -> None:
        if member.bot:
            return
        guild = member.guild
        settings = await self.store.get(guild.id)
        if not settings.raid_enabled:
            return
        now = time.time()
        triggered = self.detector.record(
            guild.id, member.id, now, settings.raid_join_threshold, settings.raid_window_seconds
        )

        if self.lockdown.is_active(guild.id, now):
            await self._handle_joiner(member, "nyan anti-raid: server in lockdown")
            return

        if triggered:
            await self.start_lockdown(
                guild,
                settings.raid_lockdown_minutes,
                f"**{settings.raid_join_threshold}+ joins within {settings.raid_window_seconds}s** detected.",
            )
            # The joins that tripped the detector are the raid: deal with them too.
            for uid in self.detector.recent(guild.id, now, settings.raid_window_seconds):
                target = guild.get_member(uid)
                if target is not None and not target.bot:
                    await self._handle_joiner(target, "nyan anti-raid: join flood")
            self.detector.reset(guild.id)
            return

        if settings.raid_flag_new_accounts and is_new_account(
            member.created_at.timestamp(), now, settings.raid_min_account_age_days
        ):
            await self._log(
                guild,
                "New account joined",
                f"{member.mention} (`{member}`) created <t:{int(member.created_at.timestamp())}:R>, "
                f"younger than {settings.raid_min_account_age_days} day(s).",
                level="warn",
                user=member,
            )

    @tasks.loop(seconds=15)
    async def expire_lockdowns(self) -> None:
        for guild_id in self.lockdown.expire(time.time()):
            guild = self.bot.get_guild(guild_id)
            if guild is not None:
                count = self.actioned.pop(guild_id, 0)
                await self._log(guild, "Lockdown ended", f"Lockdown expired. {count} joiner(s) were actioned.", level="ok")

    @expire_lockdowns.before_loop
    async def _before_expire(self) -> None:
        await self.bot.wait_until_ready()

    # ------------------------------------------------------------------ commands

    @app_commands.command(name="lockdown", description="Manually turn join lockdown on or off")
    @app_commands.describe(state="on or off", minutes="How long to stay locked down (default: the configured duration)")
    async def lockdown_cmd(
        self, interaction: discord.Interaction, state: Literal["on", "off"], minutes: Optional[app_commands.Range[int, 1, 1440]] = None
    ) -> None:
        guild = interaction.guild
        assert guild is not None
        settings = await self.store.get(guild.id)
        if state == "on":
            mins = minutes or settings.raid_lockdown_minutes
            await self.start_lockdown(guild, mins, f"Manually enabled by {interaction.user.mention}.")
            await interaction.response.send_message(f"Lockdown **on** for {mins} minute(s).", ephemeral=True)
        else:
            was = self.lockdown.end(guild.id)
            count = self.actioned.pop(guild.id, 0)
            if was:
                await self._log(guild, "Lockdown ended", f"Manually disabled by {interaction.user.mention}. {count} joiner(s) actioned.", level="ok")
            await interaction.response.send_message("Lockdown **off**." if was else "No lockdown was active.", ephemeral=True)

    @app_commands.command(name="config", description="View or change anti-raid settings (omit everything to just view)")
    @app_commands.describe(
        join_threshold="Joins within the window that trigger lockdown",
        window_seconds="Length of the sliding window",
        action="What to do to joiners during lockdown",
        timeout_minutes="Timeout length when action is timeout",
        lockdown_minutes="How long a lockdown lasts",
        flag_new_accounts="Alert in the modlog about very new accounts joining",
        min_account_age_days="Accounts younger than this many days are flagged",
    )
    async def config(
        self,
        interaction: discord.Interaction,
        join_threshold: Optional[app_commands.Range[int, 2, 100]] = None,
        window_seconds: Optional[app_commands.Range[int, 2, 300]] = None,
        action: Optional[Literal["kick", "timeout"]] = None,
        timeout_minutes: Optional[app_commands.Range[int, 1, 40320]] = None,
        lockdown_minutes: Optional[app_commands.Range[int, 1, 1440]] = None,
        flag_new_accounts: Optional[bool] = None,
        min_account_age_days: Optional[app_commands.Range[int, 1, 365]] = None,
    ) -> None:
        assert interaction.guild is not None
        changes = {
            "raid_join_threshold": join_threshold,
            "raid_window_seconds": window_seconds,
            "raid_action": action,
            "raid_timeout_minutes": timeout_minutes,
            "raid_lockdown_minutes": lockdown_minutes,
            "raid_flag_new_accounts": flag_new_accounts,
            "raid_min_account_age_days": min_account_age_days,
        }
        changes = {k: v for k, v in changes.items() if v is not None}
        s = await self.store.update(interaction.guild.id, **changes)
        locked = self.lockdown.is_active(interaction.guild.id, time.time())
        embed = discord.Embed(title="Anti-raid configuration", color=discord.Color.blurple())
        embed.description = (
            f"Enabled: **{s.raid_enabled}** (change with `/security toggle`)\n"
            f"Trigger: **{s.raid_join_threshold}** joins in **{s.raid_window_seconds}s**\n"
            f"Lockdown length: **{s.raid_lockdown_minutes}m** (currently {'ACTIVE' if locked else 'inactive'})\n"
            f"Action: **{s.raid_action}**" + (f" for {s.raid_timeout_minutes}m" if s.raid_action == "timeout" else "") + "\n"
            f"Flag new accounts: **{s.raid_flag_new_accounts}** (younger than {s.raid_min_account_age_days}d)"
        )
        await interaction.response.send_message(embed=embed, ephemeral=True)


async def setup(bot: commands.Bot) -> None:
    await bot.add_cog(AntiRaid(bot))
