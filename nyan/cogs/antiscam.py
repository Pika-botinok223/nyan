from __future__ import annotations

import logging

import discord
from discord import app_commands
from discord.ext import commands

from ..security.actions import safe_delete, safe_timeout
from ..security.guards import admin_check, protected_reason
from ..security.modlog import build_embed, excerpt, send_modlog
from ..security.scam import normalize_domain, scan_message
from ..security.settings import get_store

log = logging.getLogger("nyan.security.antiscam")


@app_commands.guild_only()
@app_commands.default_permissions(manage_guild=True)
class AntiScam(commands.GroupCog, group_name="antiscam", group_description="Scam and phishing message protection"):
    def __init__(self, bot: commands.Bot) -> None:
        self.bot = bot
        self.store = get_store(bot)

    async def cog_load(self) -> None:
        await self.store.ensure()

    async def interaction_check(self, interaction: discord.Interaction) -> bool:
        return await admin_check(interaction)

    # ------------------------------------------------------------------ scanning

    async def _scan(self, message: discord.Message) -> None:
        guild = message.guild
        author = message.author
        if guild is None or message.author.bot or not isinstance(author, discord.Member) or not message.content:
            return
        settings = await self.store.get(guild.id)
        if not settings.scam_enabled:
            return
        blocked, allowed = await self.store.domains(guild.id)
        verdict = scan_message(message.content, blocked=blocked, allowed=allowed, mentions_everyone=message.mention_everyone)
        if not verdict.flagged:
            return
        protected = protected_reason(author, guild.me)
        if protected and not protected.startswith("role"):
            return  # owner / admin / moderator: never touched

        deleted = await safe_delete(message)
        timed_out = False
        if protected is None:
            timed_out = await safe_timeout(author, settings.scam_timeout_minutes, f"nyan anti-scam: {verdict}"[:500])
        taken = ["message deleted" if deleted else "could not delete message"]
        taken.append(f"timed out {settings.scam_timeout_minutes}m" if timed_out else f"not timed out ({protected or 'failed'})")
        embed = build_embed(
            "Scam message blocked",
            f"{author.mention} in {message.channel.mention}",
            level="alert",
            fields=[("Reason", str(verdict)), ("Action", ", ".join(taken)), ("Content", excerpt(message.content))],
            user=author,
        )
        await send_modlog(guild, settings.modlog_channel_id, embed)

    @commands.Cog.listener()
    async def on_message(self, message: discord.Message) -> None:
        await self._scan(message)

    @commands.Cog.listener()
    async def on_message_edit(self, before: discord.Message, after: discord.Message) -> None:
        if before.content != after.content:
            await self._scan(after)

    # ------------------------------------------------------------------ commands

    @app_commands.command(name="block", description="Add a domain to this server's scam blocklist")
    @app_commands.describe(domain="Domain or URL, e.g. evil-site.com")
    async def block(self, interaction: discord.Interaction, domain: str) -> None:
        await self._set(interaction, domain, "block")

    @app_commands.command(name="allow", description="Add a domain to this server's allowlist (never flagged)")
    @app_commands.describe(domain="Domain or URL, e.g. discord.me")
    async def allow(self, interaction: discord.Interaction, domain: str) -> None:
        await self._set(interaction, domain, "allow")

    async def _set(self, interaction: discord.Interaction, domain: str, kind: str) -> None:
        assert interaction.guild is not None
        norm = normalize_domain(domain)
        if norm is None:
            await interaction.response.send_message("That does not look like a valid domain.", ephemeral=True)
            return
        await self.store.set_domain(interaction.guild.id, norm, kind)
        verb = "blocked" if kind == "block" else "allowed"
        await interaction.response.send_message(f"`{norm}` (and its subdomains) is now **{verb}**.", ephemeral=True)

    @app_commands.command(name="remove", description="Remove a domain from the blocklist/allowlist")
    @app_commands.describe(domain="Domain to remove")
    async def remove(self, interaction: discord.Interaction, domain: str) -> None:
        assert interaction.guild is not None
        norm = normalize_domain(domain)
        removed = bool(norm) and await self.store.remove_domain(interaction.guild.id, norm)
        await interaction.response.send_message(
            f"Removed `{norm}`." if removed else "That domain is not on either list.", ephemeral=True
        )

    @app_commands.command(name="list", description="Show the blocklist and allowlist")
    async def list_domains(self, interaction: discord.Interaction) -> None:
        assert interaction.guild is not None
        blocked, allowed = await self.store.domains(interaction.guild.id)
        embed = discord.Embed(title="Anti-scam domain lists", color=discord.Color.blurple())
        embed.add_field(name="Blocked", value="\n".join(f"`{d}`" for d in sorted(blocked))[:1024] or "none", inline=False)
        embed.add_field(name="Allowed", value="\n".join(f"`{d}`" for d in sorted(allowed))[:1024] or "none", inline=False)
        await interaction.response.send_message(embed=embed, ephemeral=True)

    @app_commands.command(name="config", description="Set how long scammers are timed out")
    @app_commands.describe(timeout_minutes="Timeout length in minutes (max 40320 = 28 days)")
    async def config(self, interaction: discord.Interaction, timeout_minutes: app_commands.Range[int, 1, 40320]) -> None:
        assert interaction.guild is not None
        await self.store.update(interaction.guild.id, scam_timeout_minutes=timeout_minutes)
        await interaction.response.send_message(f"Scammers will be timed out for {timeout_minutes} minute(s).", ephemeral=True)


async def setup(bot: commands.Bot) -> None:
    await bot.add_cog(AntiScam(bot))
