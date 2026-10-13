from __future__ import annotations

import asyncio
from types import SimpleNamespace

import discord
from discord import app_commands

from nyan.bot import NyanBot, discover_extensions
from nyan.config import Config


def make_bot(tmp_path) -> NyanBot:
    return NyanBot(Config("token", 1559417160596725830, None, str(tmp_path / "bot.db")))


async def test_every_extension_loads(tmp_path, monkeypatch):
    """Loads every cog the way the real bot does (this is what crashed on Python 3.9)."""
    bot = make_bot(tmp_path)
    never = asyncio.Event()
    monkeypatch.setattr(bot, "wait_until_ready", never.wait)  # background loops wait for a login that never comes
    await bot.db.connect()
    try:
        for ext in discover_extensions():
            await bot.load_extension(ext)
        names = {c.qualified_name for c in bot.tree.walk_commands()}
        assert {"ping", "help", "invite", "balance", "shop buy", "antiraid config", "antiscam block", "honeypot setup"} <= names
        for command in bot.tree.walk_commands():
            if isinstance(command, app_commands.Command):
                command.to_dict(bot.tree)  # the payload Discord receives must serialise
    finally:
        for cog in list(bot.cogs):
            await bot.remove_cog(cog)
        await bot.db.close()


class FakeResponse:
    def __init__(self, done: bool) -> None:
        self.done = done
        self.sent: list[str] = []

    def is_done(self) -> bool:
        return self.done

    async def send_message(self, content, **kwargs) -> None:
        self.sent.append(content)


class FakeFollowup:
    def __init__(self) -> None:
        self.sent: list[str] = []

    async def send(self, content, **kwargs) -> None:
        self.sent.append(content)


def fake_interaction(done: bool, binding=None):
    command = SimpleNamespace(binding=binding, qualified_name="test")
    return SimpleNamespace(command=command, response=FakeResponse(done), followup=FakeFollowup())


async def test_global_error_handler_replies_once(tmp_path):
    bot = make_bot(tmp_path)
    interaction = fake_interaction(done=False)
    await bot.on_app_command_error(interaction, app_commands.AppCommandError("boom"))
    assert len(interaction.response.sent) == 1 and not interaction.followup.sent

    deferred = fake_interaction(done=True)
    await bot.on_app_command_error(deferred, app_commands.AppCommandError("boom"))
    assert len(deferred.followup.sent) == 1


async def test_global_error_handler_defers_to_cog_handler_and_answered_checks(tmp_path):
    bot = make_bot(tmp_path)
    cog = SimpleNamespace(__discord_app_commands_error_handler__=lambda *a: None)
    handled = fake_interaction(done=True, binding=cog)
    await bot.on_app_command_error(handled, app_commands.AppCommandError("boom"))
    assert not handled.response.sent and not handled.followup.sent

    already_explained = fake_interaction(done=True)
    await bot.on_app_command_error(already_explained, app_commands.CheckFailure())
    assert not already_explained.followup.sent
