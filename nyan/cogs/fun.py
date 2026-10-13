from __future__ import annotations

from typing import Optional

import random
import re

import discord
from discord import app_commands
from discord.ext import commands

PINK = discord.Color.pink()

MAX_DICE = 20
MAX_SIDES = 1000
MAX_MODIFIER = 1000
_DICE_RE = re.compile(r"([0-9]{0,3})d([0-9]{1,5})(?:([+-])([0-9]{1,5}))?", re.ASCII | re.IGNORECASE)

EIGHT_BALL = (
    "It is certain, nyan~", "Without a doubt.", "Yes, definitely!", "You may rely on it.",
    "As I see it, yes.", "Most likely.", "Outlook good.", "Purr-haps yes.",
    "Reply hazy, let me nap and try again.", "Ask again later, I'm grooming.",
    "Better not tell you now.", "Cannot predict now, there's a bird outside.",
    "Don't count on it.", "My sources (the cat council) say no.", "Outlook not so good.", "Very doubtful, hiss.",
)  # fmt: skip

CATS = (
    "```\n /\\_/\\\n( o.o )\n > ^ <\n```",
    "```\n |\\__/,|   (`\\\n |_ _  |.--.) )\n ( T   )     /\n(((^_(((/(((_/\n```",
    "```\n  /\\___/\\\n ( =^.^= )\n  )     (\n (__/ \\__)\n```",
    "```\n   ___\n  /   \\\n | o o |  ~ meow\n  \\ w /\n  /|||\\\n```",
    "ฅ^•ﻌ•^ฅ", "(=^･ω･^=)", "(^・ω・^)", "(=｀ω´=)", "ミ●﹏☉ミ", "(=①ω①=)", "/ᐠ｡ꞈ｡ᐟ\\", "(=^-ω-^=)",
)  # fmt: skip

NYAN_CAT = (
    "```\n"
    "+      o     +              o\n"
    "    +             o     +       +\n"
    "o          +\n"
    "    o  +           +        +\n"
    "+        o     o       +        o\n"
    "-_-_-_-_-_-_-_,------,      o\n"
    "_-_-_-_-_-_-_-|   /\\_/\\\n"
    "-_-_-_-_-_-_-~|__( ^ .^)  +     +\n"
    "_-_-_-_-_-_-_-\"\"  \"\"\n"
    "```"
)

RPS = ("rock", "paper", "scissors")
_RPS_EMOJI = {"rock": "🪨", "paper": "📄", "scissors": "✂️"}
_BEATS = {"rock": "scissors", "paper": "rock", "scissors": "paper"}

HUGS = ("wraps {a} in a warm, fluffy hug", "tackles {a} with a gentle cuddle", "gives {a} a big squishy hug")
PATS = ("gently pats {a} on the head", "gives {a} some very good head pats", "pats {a} and gets a purr in return")


def parse_dice(expr: str) -> tuple[int, int, int]:
    """Parse ``NdM`` / ``dM`` with an optional ``+K``/``-K`` modifier into (count, sides, modifier)."""
    match = _DICE_RE.fullmatch(expr.strip().replace(" ", ""))
    if not match:
        raise ValueError("Use dice notation like `2d6`, `d20` or `3d8+2`.")
    count = int(match.group(1)) if match.group(1) else 1
    sides = int(match.group(2))
    modifier = int(match.group(4)) if match.group(4) else 0
    if match.group(3) == "-":
        modifier = -modifier
    if not 1 <= count <= MAX_DICE:
        raise ValueError(f"You can roll between 1 and {MAX_DICE} dice.")
    if not 2 <= sides <= MAX_SIDES:
        raise ValueError(f"Dice need between 2 and {MAX_SIDES} sides.")
    if abs(modifier) > MAX_MODIFIER:
        raise ValueError(f"The modifier can be at most {MAX_MODIFIER}.")
    return count, sides, modifier


def roll_dice(count: int, sides: int, modifier: int = 0, rng: Optional[random.Random] = None) -> tuple[list[int], int]:
    rng = rng or random
    rolls = [rng.randint(1, sides) for _ in range(count)]
    return rolls, sum(rolls) + modifier


def parse_options(raw: str, max_options: int = 25) -> list[str]:
    options = [o.strip() for o in raw.split(",") if o.strip()]
    if len(options) < 2:
        raise ValueError("Give me at least two options separated by commas.")
    if len(options) > max_options:
        raise ValueError(f"That's too many options (max {max_options}).")
    if any(len(o) > 100 for o in options):
        raise ValueError("Each option can be at most 100 characters.")
    return options


def rps_result(player: str, bot: str) -> str:
    """Returns ``win``, ``lose`` or ``draw`` from the player's perspective."""
    if player == bot:
        return "draw"
    return "win" if _BEATS[player] == bot else "lose"


def embed(title: str, description: str) -> discord.Embed:
    return discord.Embed(title=title, description=description, color=PINK)


class Fun(commands.Cog):
    def __init__(self, bot: commands.Bot) -> None:
        self.bot = bot

    @app_commands.command(name="8ball", description="Ask the magic 8-ball a question")
    async def eight_ball(self, interaction: discord.Interaction, question: app_commands.Range[str, 1, 200]) -> None:
        e = embed("🎱 Magic 8-ball", random.choice(EIGHT_BALL))
        e.add_field(name="Question", value=discord.utils.escape_mentions(question), inline=False)
        await interaction.response.send_message(embed=e)

    @app_commands.command(name="roll", description="Roll dice, e.g. 2d6 or 3d8+2")
    async def roll(self, interaction: discord.Interaction, dice: app_commands.Range[str, 1, 20] = "1d6") -> None:
        try:
            count, sides, mod = parse_dice(dice)
        except ValueError as exc:
            await interaction.response.send_message(str(exc), ephemeral=True)
            return
        rolls, total = roll_dice(count, sides, mod)
        detail = f"[{', '.join(map(str, rolls))}]" + (f" {mod:+d}" if mod else "")
        notation = f"{count}d{sides}" + (f"{mod:+d}" if mod else "")
        await interaction.response.send_message(embed=embed(f"🎲 {notation}", f"{detail}\nTotal: **{total}**"))

    @app_commands.command(name="choose", description="Let nyan pick between comma-separated options")
    async def choose(self, interaction: discord.Interaction, options: app_commands.Range[str, 1, 1000]) -> None:
        try:
            parsed = parse_options(options)
        except ValueError as exc:
            await interaction.response.send_message(str(exc), ephemeral=True)
            return
        pick = discord.utils.escape_mentions(random.choice(parsed))
        await interaction.response.send_message(embed=embed("🤔 I choose...", f"**{pick}**"))

    @app_commands.command(name="cat", description="A random cat")
    async def cat(self, interaction: discord.Interaction) -> None:
        await interaction.response.send_message(embed=embed("Meow~", random.choice(CATS)))

    @app_commands.command(name="nyan", description="Nyan nyan nyan nyan")
    async def nyan(self, interaction: discord.Interaction) -> None:
        await interaction.response.send_message(embed=embed("🌈 Nyan nyan nyan~", NYAN_CAT))

    @app_commands.command(name="rps", description="Play rock paper scissors against nyan")
    @app_commands.choices(choice=[app_commands.Choice(name=r, value=r) for r in RPS])
    async def rps(self, interaction: discord.Interaction, choice: app_commands.Choice[str]) -> None:
        mine = random.choice(RPS)
        result = rps_result(choice.value, mine)
        verdict = {"win": "You win! 🎉", "lose": "I win, nyan~ 😸", "draw": "It's a draw."}[result]
        await interaction.response.send_message(
            embed=embed("Rock Paper Scissors", f"You: {_RPS_EMOJI[choice.value]} {choice.value}\nMe: {_RPS_EMOJI[mine]} {mine}\n\n{verdict}")
        )

    @app_commands.command(name="hug", description="Give someone a hug")
    @app_commands.guild_only()
    async def hug(self, interaction: discord.Interaction, user: discord.Member) -> None:
        await self._affection(interaction, user, HUGS, "🤗")

    @app_commands.command(name="pat", description="Pat someone on the head")
    @app_commands.guild_only()
    async def pat(self, interaction: discord.Interaction, user: discord.Member) -> None:
        await self._affection(interaction, user, PATS, "🐾")

    async def _affection(self, interaction: discord.Interaction, user: discord.Member, lines: tuple[str, ...], icon: str) -> None:
        if user.id == interaction.user.id:
            text = "Aww, you can't do that to yourself... so nyan will do it for you! 💖"
        else:
            text = f"{interaction.user.mention} {random.choice(lines).format(a=user.mention)} {icon}"
        await interaction.response.send_message(embed=embed(icon, text))


async def setup(bot: commands.Bot) -> None:
    await bot.add_cog(Fun(bot))
