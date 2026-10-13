from __future__ import annotations

import logging

import discord
from discord import app_commands
from discord.ext import commands

from .. import __version__

log = logging.getLogger("nyan.core")

DEFAULT_CLIENT_ID = 1559417160596725830
TERMS_URL = "https://pika-botinok223.github.io/nyan/terms.html"
PRIVACY_URL = "https://pika-botinok223.github.io/nyan/privacy.html"
ISSUES_URL = "https://github.com/pika-botinok223/nyan/issues"


REQUIRED_PERMISSIONS = discord.Permissions(
    view_channel=True,
    send_messages=True,
    embed_links=True,
    read_message_history=True,
    manage_messages=True,  # delete scam/spam/honeypot messages
    kick_members=True,  # anti-raid lockdown kicks
    ban_members=True,  # honeypot bans/softbans
    moderate_members=True,  # timeouts (anti-scam, spam, anti-raid)
    manage_roles=True,  # shop role rewards
    manage_channels=True,  # /honeypot setup creates the trap channel
)

# What stops working when a permission is missing (shown in the on_guild_join notice).
PERMISSION_INFO: dict[str, tuple[str, str]] = {
    "view_channel": ("View Channels", "nyan can't see channels to protect them"),
    "send_messages": ("Send Messages", "nyan can't reply or post alerts"),
    "embed_links": ("Embed Links", "nyan's embeds and mod-log reports won't show"),
    "read_message_history": ("Read Message History", "nyan can't read messages it should check"),
    "manage_messages": ("Manage Messages", "can't delete scam, spam and honeypot messages"),
    "kick_members": ("Kick Members", "anti-raid can't kick joiners during a lockdown"),
    "ban_members": ("Ban Members", "the honeypot can't ban spambots"),
    "moderate_members": ("Timeout Members", "can't time out scammers, spammers or raiders"),
    "manage_roles": ("Manage Roles", "shop role rewards can't be handed out"),
    "manage_channels": ("Manage Channels", "/honeypot setup can't create the trap channel"),
}


def invite_url(client_id: int) -> str:
    """OAuth2 invite link that asks for exactly ``REQUIRED_PERMISSIONS``."""
    return discord.utils.oauth_url(
        client_id,
        permissions=REQUIRED_PERMISSIONS,
        scopes=("bot", "applications.commands"),
    )


def missing_permissions(perms: discord.Permissions) -> list[str]:
    """Names of ``REQUIRED_PERMISSIONS`` that ``perms`` lacks (Administrator counts as having all)."""
    if perms.administrator:
        return []
    return [name for name, value in REQUIRED_PERMISSIONS if value and not getattr(perms, name)]


def pick_welcome_channel(guild: discord.Guild) -> discord.abc.Messageable | None:
    """The system channel if nyan can talk there, else the first text channel where it can."""
    me = guild.me
    candidates = [guild.system_channel, *guild.text_channels]
    for channel in candidates:
        if channel is not None and channel.permissions_for(me).send_messages:
            return channel
    return None


class Core(commands.Cog):
    def __init__(self, bot: commands.Bot) -> None:
        self.bot = bot

    def _invite(self) -> str:
        client_id = self.bot.application_id or (self.bot.user.id if self.bot.user else None) or DEFAULT_CLIENT_ID
        return invite_url(client_id)

    @commands.Cog.listener()
    async def on_guild_join(self, guild: discord.Guild) -> None:
        missing = missing_permissions(guild.me.guild_permissions)
        if not missing:
            return
        lines = []
        for name in missing:
            label, effect = PERMISSION_INFO.get(name, (name.replace("_", " ").title(), "some features won't work"))
            lines.append(f"- **{label}**: {effect}")
        embed = discord.Embed(
            title="Thanks for adding nyan! 🐾",
            description=(
                "I'm missing some permissions I need, so parts of my protection won't work:\n"
                + "\n".join(lines)
                + f"\n\n[Re-invite me with the right permissions]({self._invite()}) "
                "(no need to kick me first), or grant these in my role settings. "
                "Also drag my role above the roles I should moderate or sell."
            ),
            color=discord.Color.pink(),
        )
        channel = pick_welcome_channel(guild)
        if channel is None:
            log.info("no channel to send the permissions notice in guild %s", guild.id)
            return
        try:
            await channel.send(embed=embed)
        except (discord.Forbidden, discord.HTTPException) as exc:
            log.warning("could not send the permissions notice in guild %s: %s", guild.id, exc)

    @app_commands.command(name="ping", description="Check if nyan is awake")
    async def ping(self, interaction: discord.Interaction) -> None:
        await interaction.response.send_message(f"nyan~ 🐾 `{round(self.bot.latency * 1000)}ms`")

    @app_commands.command(name="invite", description="Get the link to add nyan to your server")
    async def invite(self, interaction: discord.Interaction) -> None:
        await interaction.response.send_message(f"Add nyan to your server: {self._invite()} 🐾", ephemeral=True)

    @app_commands.command(name="terms", description="Read nyan's Terms of Service")
    async def terms(self, interaction: discord.Interaction) -> None:
        await interaction.response.send_message(f"nyan's Terms of Service: {TERMS_URL}", ephemeral=True)

    @app_commands.command(name="privacy", description="Read nyan's Privacy Policy")
    async def privacy(self, interaction: discord.Interaction) -> None:
        await interaction.response.send_message(f"nyan's Privacy Policy: {PRIVACY_URL}", ephemeral=True)

    @app_commands.command(name="help", description="List nyan's commands")
    async def help(self, interaction: discord.Interaction) -> None:
        embed = discord.Embed(title=f"nyan v{__version__}", color=discord.Color.pink())
        lines: dict[str, list[str]] = {}
        for cmd in self.bot.tree.walk_commands():
            if isinstance(cmd, app_commands.Group):
                continue
            cog_name = cmd.binding.__class__.__name__ if cmd.binding else "Other"
            lines.setdefault(cog_name, []).append(f"`/{cmd.qualified_name}` — {cmd.description}")
        for cog_name, entries in sorted(lines.items()):
            embed.add_field(name=cog_name, value="\n".join(sorted(entries))[:1024], inline=False)
        await interaction.response.send_message(embed=embed, ephemeral=True)


async def setup(bot: commands.Bot) -> None:
    await bot.add_cog(Core(bot))
