from __future__ import annotations

import logging
import pkgutil

import discord
from discord import app_commands
from discord.ext import commands

from . import cogs
from .config import Config
from .db import Database

log = logging.getLogger("nyan")


def discover_extensions() -> list[str]:
    """Every module in nyan/cogs that defines ``async def setup(bot)`` is loaded."""
    return [f"{cogs.__name__}.{m.name}" for m in pkgutil.iter_modules(cogs.__path__) if not m.name.startswith("_")]


class NyanBot(commands.Bot):
    def __init__(self, config: Config) -> None:
        intents = discord.Intents.default()
        intents.members = True  # privileged: needed for join tracking (anti-raid)
        intents.message_content = True  # privileged: needed for scam/spam scanning
        super().__init__(
            command_prefix=commands.when_mentioned,
            intents=intents,
            application_id=config.application_id,
            allowed_mentions=discord.AllowedMentions(everyone=False, roles=False, users=True),
        )
        self.config = config
        self.db = Database(config.database_path)
        self.tree.on_error = self.on_app_command_error

    async def on_app_command_error(self, interaction: discord.Interaction, error: app_commands.AppCommandError) -> None:
        """Last-resort handler so a failing command never leaves "The application did not respond"."""
        command = interaction.command
        if getattr(getattr(command, "binding", None), "__discord_app_commands_error_handler__", None) is not None:
            return  # the cog's own cog_app_command_error already dealt with it
        if isinstance(error, app_commands.CheckFailure):
            if interaction.response.is_done():
                return  # the check (e.g. admin_check) already explained why
            message = "You can't use that command here."
        else:
            log.error("Error in /%s", command.qualified_name if command else "?", exc_info=error)
            message = "Something went wrong running that command, nyan~ 😿"
        try:
            if interaction.response.is_done():
                await interaction.followup.send(message, ephemeral=True)
            else:
                await interaction.response.send_message(message, ephemeral=True)
        except discord.HTTPException:
            pass

    async def setup_hook(self) -> None:
        await self.db.connect()
        for ext in discover_extensions():
            await self.load_extension(ext)
            log.info("Loaded extension %s", ext)

        if self.config.dev_guild_id:
            guild = discord.Object(id=self.config.dev_guild_id)
            self.tree.copy_global_to(guild=guild)
            synced = await self.tree.sync(guild=guild)
            log.info("Synced %d commands to dev guild %s", len(synced), self.config.dev_guild_id)
        else:
            synced = await self.tree.sync()
            log.info("Synced %d global commands", len(synced))

    async def close(self) -> None:
        await super().close()
        await self.db.close()

    async def on_ready(self) -> None:
        log.info("Logged in as %s (%s) in %d guilds", self.user, getattr(self.user, "id", "?"), len(self.guilds))
        await self.change_presence(activity=discord.Game(name="/help • nyan~"))
