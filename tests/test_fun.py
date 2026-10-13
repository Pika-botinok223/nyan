from __future__ import annotations

import random

import pytest
from discord import app_commands
from discord.ext import commands

import discord
from nyan.cogs.fun import (
    MAX_DICE,
    MAX_SIDES,
    Fun,
    parse_dice,
    parse_options,
    roll_dice,
    rps_result,
)


@pytest.mark.parametrize(
    ("expr", "expected"),
    [
        ("2d6", (2, 6, 0)),
        ("d20", (1, 20, 0)),
        ("1D8", (1, 8, 0)),
        ("3d8+2", (3, 8, 2)),
        (" 4d4 - 1 ", (4, 4, -1)),
        (f"{MAX_DICE}d{MAX_SIDES}", (MAX_DICE, MAX_SIDES, 0)),
    ],
)
def test_parse_dice_valid(expr, expected):
    assert parse_dice(expr) == expected


@pytest.mark.parametrize(
    "expr",
    ["", "abc", "2d", "d", "0d6", f"{MAX_DICE + 1}d6", "2d1", "2d0", f"1d{MAX_SIDES + 1}", "2d6+", "2d6*3",
     "2d6+99999", "-2d6", "2d6; drop", "999d999999", "２d６"],
)  # fmt: skip
def test_parse_dice_invalid(expr):
    with pytest.raises(ValueError):
        parse_dice(expr)


def test_roll_dice_bounds_and_modifier():
    rolls, total = roll_dice(5, 6, 3, rng=random.Random(0))
    assert len(rolls) == 5 and all(1 <= r <= 6 for r in rolls)
    assert total == sum(rolls) + 3


def test_parse_options():
    assert parse_options("pizza, sushi ,, tacos") == ["pizza", "sushi", "tacos"]
    for bad in ("only one", ",,,", ",".join("a" * 5 for _ in range(26)), "a," + "x" * 101):
        with pytest.raises(ValueError):
            parse_options(bad)


def test_rps_result():
    assert rps_result("rock", "scissors") == "win"
    assert rps_result("rock", "paper") == "lose"
    assert rps_result("paper", "paper") == "draw"
    assert rps_result("scissors", "paper") == "win"


async def test_cogs_register_expected_commands(db):
    from nyan.cogs.economy import Economy

    bot = commands.Bot(command_prefix=commands.when_mentioned, intents=discord.Intents.none())
    bot.db = db  # type: ignore[attr-defined]
    await bot.add_cog(Fun(bot))
    await bot.add_cog(Economy(bot))
    names = {c.qualified_name for c in bot.tree.walk_commands() if not isinstance(c, app_commands.Group)}
    assert {"8ball", "roll", "choose", "cat", "nyan", "rps", "hug", "pat"} <= names
    assert {
        "balance", "daily", "work", "pay", "leaderboard", "coinflip", "slots", "inventory",
        "economy config", "economy give", "economy take",
        "shop add", "shop remove", "shop list", "shop buy",
    } <= names  # fmt: skip
    await bot.close()
