from __future__ import annotations

import logging
import random
from typing import Literal, Optional

import discord
from discord import app_commands
from discord.ext import commands

from ..economy import (
    MAX_AMOUNT,
    CurrencyConfig,
    EconomyError,
    EconomyRepo,
    OnCooldown,
    coinflip_net,
    slots_payout,
    spin_slots,
)

log = logging.getLogger("nyan.economy")

PINK = discord.Color.pink()
Amount = app_commands.Range[int, 1, MAX_AMOUNT]
ADMIN = app_commands.checks.has_permissions(manage_guild=True)


def embed(title: str, description: Optional[str] = None) -> discord.Embed:
    return discord.Embed(title=title, description=description, color=PINK)


def cooldown_text(error: OnCooldown) -> str:
    return f"You need to wait a bit! Try again <t:{int(error.available_at)}:R>."


async def respond_error(interaction: discord.Interaction, message: str) -> None:
    if interaction.response.is_done():
        await interaction.followup.send(message, ephemeral=True)
    else:
        await interaction.response.send_message(message, ephemeral=True)


class Economy(commands.Cog):
    economy = app_commands.Group(
        name="economy",
        description="Configure and administer the server economy",
        guild_only=True,
        default_permissions=discord.Permissions(manage_guild=True),
    )
    shop = app_commands.Group(name="shop", description="The server shop", guild_only=True)

    def __init__(self, bot: commands.Bot) -> None:
        self.bot = bot
        self.repo = EconomyRepo(bot.db)  # type: ignore[attr-defined]

    async def cog_load(self) -> None:
        await self.repo.setup()

    async def cog_app_command_error(self, interaction: discord.Interaction, error: app_commands.AppCommandError) -> None:
        original = getattr(error, "original", error)
        if isinstance(original, OnCooldown):
            await respond_error(interaction, cooldown_text(original))
        elif isinstance(original, EconomyError):
            await respond_error(interaction, f"😿 {original}")
        elif isinstance(error, app_commands.MissingPermissions):
            await respond_error(interaction, "You need the **Manage Server** permission to do that.")
        elif isinstance(error, app_commands.NoPrivateMessage):
            await respond_error(interaction, "This only works in servers.")
        else:
            log.exception("Unhandled economy command error", exc_info=error)
            await respond_error(interaction, "Something went wrong, nyan~")

    async def _cfg(self, interaction: discord.Interaction) -> CurrencyConfig:
        assert interaction.guild_id is not None
        return await self.repo.get_config(interaction.guild_id)

    # --- balances ---------------------------------------------------------------------------

    @app_commands.command(name="balance", description="Check your (or someone else's) balance")
    @app_commands.guild_only()
    async def balance(self, interaction: discord.Interaction, user: Optional[discord.Member] = None) -> None:
        target = user or interaction.user
        cfg = await self._cfg(interaction)
        bal = await self.repo.balance(interaction.guild_id, target.id)  # type: ignore[arg-type]
        await interaction.response.send_message(embed=embed(f"{target.display_name}'s balance", cfg.fmt(bal)))

    @app_commands.command(name="daily", description="Claim your daily reward (streaks give a bonus)")
    @app_commands.guild_only()
    async def daily(self, interaction: discord.Interaction) -> None:
        cfg = await self._cfg(interaction)
        res = await self.repo.claim_daily(interaction.guild_id, interaction.user.id)  # type: ignore[arg-type]
        e = embed("Daily reward", f"You claimed {cfg.fmt(res.reward)}!")
        e.add_field(name="Streak", value=f"🔥 {res.streak} day(s)")
        e.add_field(name="Balance", value=cfg.fmt(res.balance))
        await interaction.response.send_message(embed=e)

    @app_commands.command(name="work", description="Do a little job for some coins (1 hour cooldown)")
    @app_commands.guild_only()
    async def work(self, interaction: discord.Interaction) -> None:
        cfg = await self._cfg(interaction)
        res = await self.repo.claim_work(interaction.guild_id, interaction.user.id)  # type: ignore[arg-type]
        e = embed("Work", f"{res.flavor}\nYou earned {cfg.fmt(res.payout)}.")
        e.set_footer(text=f"Balance: {res.balance:,}")
        await interaction.response.send_message(embed=e)

    @app_commands.command(name="pay", description="Give some of your coins to another member")
    @app_commands.guild_only()
    async def pay(self, interaction: discord.Interaction, user: discord.Member, amount: Amount) -> None:
        if user.bot:
            await respond_error(interaction, "Bots have no use for coins, nyan~")
            return
        if user.id == interaction.user.id:
            await respond_error(interaction, "You can't pay yourself.")
            return
        cfg = await self._cfg(interaction)
        mine, _ = await self.repo.transfer(interaction.guild_id, interaction.user.id, user.id, amount)  # type: ignore[arg-type]
        await interaction.response.send_message(
            embed=embed("Payment sent", f"{interaction.user.mention} paid {user.mention} {cfg.fmt(amount)}.").set_footer(
                text=f"Your balance: {mine:,}"
            )
        )

    @app_commands.command(name="leaderboard", description="Show the richest members of this server")
    @app_commands.guild_only()
    async def leaderboard(self, interaction: discord.Interaction) -> None:
        cfg = await self._cfg(interaction)
        rows = await self.repo.leaderboard(interaction.guild_id, 10)  # type: ignore[arg-type]
        if not rows:
            await interaction.response.send_message(embed=embed("Leaderboard", "Nobody has any coins yet. Try `/daily`!"))
            return
        medals = ["🥇", "🥈", "🥉"]
        lines = [f"{medals[i] if i < 3 else f'`{i + 1}.`'} <@{uid}> — {cfg.fmt(bal)}" for i, (uid, bal) in enumerate(rows)]
        await interaction.response.send_message(
            embed=embed(f"{cfg.emoji} Richest in {interaction.guild.name if interaction.guild else 'server'}", "\n".join(lines))
        )

    # --- gambling ---------------------------------------------------------------------------

    @app_commands.command(name="coinflip", description="Bet on a coin flip (win = double your bet)")
    @app_commands.guild_only()
    async def coinflip(self, interaction: discord.Interaction, amount: Amount, side: Literal["heads", "tails"]) -> None:
        cfg = await self._cfg(interaction)
        result = random.choice(("heads", "tails"))
        won = result == side
        bal = await self.repo.wager(interaction.guild_id, interaction.user.id, amount, coinflip_net(amount, won))  # type: ignore[arg-type]
        text = f"The coin landed on **{result}**.\n" + (f"You won {cfg.fmt(amount)}! 🎉" if won else f"You lost {cfg.fmt(amount)}. 😿")
        await interaction.response.send_message(embed=embed("Coinflip", text).set_footer(text=f"Balance: {bal:,}"))

    @app_commands.command(name="slots", description="Spin the slot machine")
    @app_commands.guild_only()
    async def slots(self, interaction: discord.Interaction, amount: Amount) -> None:
        cfg = await self._cfg(interaction)
        reels = spin_slots()
        payout = slots_payout(reels, amount)
        bal = await self.repo.wager(interaction.guild_id, interaction.user.id, amount, payout - amount)  # type: ignore[arg-type]
        if payout > amount:
            outcome = f"You won {cfg.fmt(payout - amount)}! 🎉"
        elif payout == amount:
            outcome = "You broke even."
        elif payout > 0:
            outcome = f"Almost! You got back {cfg.fmt(payout)} of your bet."
        else:
            outcome = f"You lost {cfg.fmt(amount)}. 😿"
        e = embed("Slots", f"**[ {' | '.join(reels)} ]**\n{outcome}")
        await interaction.response.send_message(embed=e.set_footer(text=f"Balance: {bal:,}"))

    # --- admin ------------------------------------------------------------------------------

    @economy.command(name="config", description="Set this server's currency name and emoji")
    @ADMIN
    @app_commands.describe(name="Currency name, e.g. 'fish'", emoji="Currency emoji, e.g. 🐟")
    async def config(
        self,
        interaction: discord.Interaction,
        name: Optional[app_commands.Range[str, 1, 32]] = None,
        emoji: Optional[app_commands.Range[str, 1, 64]] = None,
    ) -> None:
        assert interaction.guild_id is not None
        cfg = await self.repo.set_config(interaction.guild_id, name, emoji)
        await interaction.response.send_message(
            embed=embed("Currency updated", f"Your currency is now {cfg.emoji} **{cfg.name}**."), ephemeral=True
        )

    @economy.command(name="give", description="Give a member coins out of thin air")
    @ADMIN
    async def give(self, interaction: discord.Interaction, user: discord.Member, amount: Amount) -> None:
        assert interaction.guild_id is not None
        if user.bot:
            await respond_error(interaction, "Bots have no use for coins, nyan~")
            return
        cfg = await self._cfg(interaction)
        bal = await self.repo.add(interaction.guild_id, user.id, amount)
        await interaction.response.send_message(
            embed=embed("Coins given", f"Gave {user.mention} {cfg.fmt(amount)}. They now have {cfg.fmt(bal)}.")
        )

    @economy.command(name="take", description="Take coins away from a member")
    @ADMIN
    async def take(self, interaction: discord.Interaction, user: discord.Member, amount: Amount) -> None:
        assert interaction.guild_id is not None
        cfg = await self._cfg(interaction)
        bal = await self.repo.take(interaction.guild_id, user.id, amount)
        await interaction.response.send_message(
            embed=embed("Coins taken", f"Took up to {cfg.fmt(amount)} from {user.mention}. They now have {cfg.fmt(bal)}.")
        )

    # --- shop -------------------------------------------------------------------------------

    @shop.command(name="add", description="Add an item to the shop (optionally granting a role)")
    @ADMIN
    async def shop_add(
        self,
        interaction: discord.Interaction,
        name: app_commands.Range[str, 1, 50],
        price: Amount,
        role: Optional[discord.Role] = None,
    ) -> None:
        guild, member = interaction.guild, interaction.user
        assert guild is not None and interaction.guild_id is not None
        if role is not None:
            # Stop admins using the shop to hand out roles above their own (privilege escalation).
            if role.is_default() or role.managed:
                await respond_error(interaction, "That role can't be handed out by the shop.")
                return
            if role >= guild.me.top_role:
                await respond_error(interaction, "I can only hand out roles that are below my highest role.")
                return
            if isinstance(member, discord.Member) and member.id != guild.owner_id and role >= member.top_role:
                await respond_error(interaction, "You can only sell roles that are below your own highest role.")
                return
        item = await self.repo.add_item(interaction.guild_id, name, price, role.id if role else None)
        cfg = await self._cfg(interaction)
        extra = f" (grants {role.mention})" if role else ""
        await interaction.response.send_message(
            embed=embed("Shop item added", f"**{item.name}** for {cfg.fmt(item.price)}{extra}"), ephemeral=True
        )

    @shop.command(name="remove", description="Remove an item from the shop")
    @ADMIN
    async def shop_remove(self, interaction: discord.Interaction, name: app_commands.Range[str, 1, 50]) -> None:
        assert interaction.guild_id is not None
        if not await self.repo.remove_item(interaction.guild_id, name):
            await respond_error(interaction, f"There's no item called **{name}**.")
            return
        await interaction.response.send_message(embed=embed("Shop item removed", f"Removed **{name}**."), ephemeral=True)

    @shop.command(name="list", description="Browse the shop")
    async def shop_list(self, interaction: discord.Interaction) -> None:
        assert interaction.guild_id is not None
        cfg = await self._cfg(interaction)
        items = await self.repo.list_items(interaction.guild_id)
        if not items:
            await interaction.response.send_message(embed=embed("Shop", "The shop is empty."))
            return
        lines = [f"**{i.name}** — {cfg.fmt(i.price)}" + (f" • grants <@&{i.role_id}>" if i.role_id else "") for i in items]
        await interaction.response.send_message(embed=embed("Shop", "\n".join(lines)))

    @shop.command(name="buy", description="Buy an item from the shop")
    async def shop_buy(self, interaction: discord.Interaction, name: app_commands.Range[str, 1, 50]) -> None:
        guild, member = interaction.guild, interaction.user
        assert guild is not None and interaction.guild_id is not None and isinstance(member, discord.Member)
        existing = await self.repo.get_item(interaction.guild_id, name)
        role = guild.get_role(existing.role_id) if existing and existing.role_id else None
        if existing and existing.role_id and role is None:
            await respond_error(interaction, "That item's role no longer exists. Ask an admin to fix the shop.")
            return
        if role is not None and role in member.roles:
            await respond_error(interaction, "You already have that role!")
            return
        item, bal = await self.repo.buy(interaction.guild_id, member.id, name)
        cfg = await self._cfg(interaction)
        note = ""
        if role is not None:
            try:
                await member.add_roles(role, reason=f"Bought '{item.name}' from the nyan shop")
                note = f"\nYou were given {role.mention}!"
            except (discord.Forbidden, discord.HTTPException):
                bal = await self.repo.refund_purchase(interaction.guild_id, member.id, item)
                await respond_error(
                    interaction, f"😿 I couldn't give you that role (check my permissions/role order), so you were refunded. Balance: {bal:,}"
                )
                return
        await interaction.response.send_message(
            embed=embed("Purchase complete", f"You bought **{item.name}** for {cfg.fmt(item.price)}.{note}").set_footer(
                text=f"Balance: {bal:,}"
            )
        )

    @app_commands.command(name="inventory", description="See what you (or someone else) own")
    @app_commands.guild_only()
    async def inventory(self, interaction: discord.Interaction, user: Optional[discord.Member] = None) -> None:
        target = user or interaction.user
        rows = await self.repo.inventory(interaction.guild_id, target.id)  # type: ignore[arg-type]
        body = "\n".join(f"{qty}× **{name}**" for name, qty in rows) or "Nothing yet. Check out `/shop list`!"
        await interaction.response.send_message(embed=embed(f"{target.display_name}'s inventory", body))


async def setup(bot: commands.Bot) -> None:
    await bot.add_cog(Economy(bot))
