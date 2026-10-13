from __future__ import annotations

import discord
from discord import app_commands
from discord.ext import commands

from .. import __version__


class Core(commands.Cog):
    def __init__(self, bot: commands.Bot) -> None:
        self.bot = bot

    @app_commands.command(name="ping", description="Check if nyan is awake")
    async def ping(self, interaction: discord.Interaction) -> None:
        await interaction.response.send_message(f"nyan~ 🐾 `{round(self.bot.latency * 1000)}ms`")

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
