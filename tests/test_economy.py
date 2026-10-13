from __future__ import annotations

import asyncio
import random

import pytest

from nyan.economy import (
    DAILY_COOLDOWN,
    WORK_COOLDOWN,
    EconomyError,
    EconomyRepo,
    InsufficientFunds,
    InvalidAmount,
    OnCooldown,
    coinflip_net,
    daily_reward,
    slots_payout,
    spin_slots,
)

G, A, B = 1, 100, 200


@pytest.fixture
async def repo(db):
    r = EconomyRepo(db)
    await r.setup()
    return r


async def test_balance_get_add_and_guild_scoping(repo):
    assert await repo.balance(G, A) == 0
    assert await repo.add(G, A, 50) == 50
    assert await repo.add(G, A, 25) == 75
    assert await repo.balance(G, A) == 75
    assert await repo.balance(2, A) == 0  # other guild is untouched
    with pytest.raises(InvalidAmount):
        await repo.add(G, A, 0)


async def test_take_clamps_at_zero(repo):
    await repo.add(G, A, 30)
    assert await repo.take(G, A, 10) == 20
    assert await repo.take(G, A, 1000) == 0


async def test_config_defaults_and_update(repo):
    cfg = await repo.get_config(G)
    assert (cfg.name, cfg.emoji) == ("nyancoins", "🪙")
    cfg = await repo.set_config(G, name="fish")
    assert (cfg.name, cfg.emoji) == ("fish", "🪙")
    cfg = await repo.set_config(G, emoji="🐟")
    assert (cfg.name, cfg.emoji) == ("fish", "🐟")
    assert (await repo.get_config(2)).name == "nyancoins"
    with pytest.raises(EconomyError):
        await repo.set_config(G, name="x" * 33)


async def test_transfer_success(repo):
    await repo.add(G, A, 100)
    assert await repo.transfer(G, A, B, 40) == (60, 40)
    assert await repo.balance(G, A) == 60 and await repo.balance(G, B) == 40


async def test_transfer_insufficient_funds_changes_nothing(repo):
    await repo.add(G, A, 10)
    await repo.add(G, B, 5)
    with pytest.raises(InsufficientFunds):
        await repo.transfer(G, A, B, 11)
    assert await repo.balance(G, A) == 10 and await repo.balance(G, B) == 5


async def test_transfer_rejects_self_and_bad_amounts(repo):
    await repo.add(G, A, 100)
    with pytest.raises(InvalidAmount):
        await repo.transfer(G, A, A, 10)
    with pytest.raises(InvalidAmount):
        await repo.transfer(G, A, B, 0)
    with pytest.raises(InvalidAmount):
        await repo.transfer(G, A, B, -5)
    assert await repo.balance(G, A) == 100


async def test_concurrent_transfers_never_overspend(repo):
    await repo.add(G, A, 100)
    results = await asyncio.gather(*(repo.transfer(G, A, B, 30) for _ in range(10)), return_exceptions=True)
    ok = [r for r in results if not isinstance(r, Exception)]
    assert len(ok) == 3
    assert await repo.balance(G, A) == 10 and await repo.balance(G, B) == 90


async def test_wager_settles_or_rejects(repo):
    await repo.add(G, A, 50)
    assert await repo.wager(G, A, 50, coinflip_net(50, True)) == 100
    assert await repo.wager(G, A, 100, coinflip_net(100, False)) == 0
    with pytest.raises(InsufficientFunds):
        await repo.wager(G, A, 10, -10)


async def test_daily_cooldown_and_streak(repo):
    t0 = 1_000_000.0
    first = await repo.claim_daily(G, A, now=t0)
    assert (first.streak, first.reward, first.balance) == (1, daily_reward(1), daily_reward(1))
    with pytest.raises(OnCooldown) as exc:
        await repo.claim_daily(G, A, now=t0 + 3600)
    assert exc.value.remaining == pytest.approx(DAILY_COOLDOWN - 3600)
    second = await repo.claim_daily(G, A, now=t0 + DAILY_COOLDOWN + 5)
    assert second.streak == 2 and second.reward == daily_reward(2) > first.reward
    # miss more than 48h -> streak resets
    third = await repo.claim_daily(G, A, now=t0 + DAILY_COOLDOWN + 5 + 3 * DAILY_COOLDOWN)
    assert third.streak == 1 and third.reward == daily_reward(1)


async def test_daily_is_per_guild_and_per_user(repo):
    t0 = 5_000_000.0
    await repo.claim_daily(G, A, now=t0)
    await repo.claim_daily(G, B, now=t0)
    await repo.claim_daily(2, A, now=t0)


def test_daily_reward_is_capped():
    assert daily_reward(1) < daily_reward(2)
    assert daily_reward(10_000) == daily_reward(1_000)


async def test_work_cooldown_and_payout(repo):
    t0 = 2_000_000.0
    rng = random.Random(1)
    res = await repo.claim_work(G, A, now=t0, rng=rng)
    assert 20 <= res.payout <= 120 and res.balance == res.payout and res.flavor
    with pytest.raises(OnCooldown):
        await repo.claim_work(G, A, now=t0 + WORK_COOLDOWN - 1, rng=rng)
    res2 = await repo.claim_work(G, A, now=t0 + WORK_COOLDOWN, rng=rng)
    assert res2.balance == res.payout + res2.payout


async def test_cooldowns_survive_restart(db):
    r1 = EconomyRepo(db)
    await r1.setup()
    await r1.claim_daily(G, A, now=1_000_000.0)
    r2 = EconomyRepo(db)  # fresh instance, same database
    await r2.setup()
    with pytest.raises(OnCooldown):
        await r2.claim_daily(G, A, now=1_000_100.0)


async def test_leaderboard_order_and_limit(repo):
    for uid, amt in [(1, 10), (2, 50), (3, 30), (4, 0)]:
        await repo.add(G, uid, amt) if amt else await repo.balance(G, uid)
    assert await repo.leaderboard(G, 2) == [(2, 50), (3, 30)]
    assert await repo.leaderboard(G, 10) == [(2, 50), (3, 30), (1, 10)]


async def test_shop_add_list_remove(repo):
    item = await repo.add_item(G, "Cat Ears", 100, role_id=555)
    assert item.role_id == 555 and item.price == 100
    with pytest.raises(EconomyError):
        await repo.add_item(G, "cat ears", 5)  # names are case-insensitive unique
    await repo.add_item(G, "Fish", 10)
    assert [i.name for i in await repo.list_items(G)] == ["Fish", "Cat Ears"]
    assert await repo.get_item(G, "CAT EARS") is not None
    assert await repo.remove_item(G, "fish") is True
    assert await repo.remove_item(G, "fish") is False


async def test_shop_buy_and_inventory(repo):
    await repo.add_item(G, "Fish", 40)
    await repo.add(G, A, 100)
    item, bal = await repo.buy(G, A, "fish")
    assert (item.name, bal) == ("Fish", 60)
    await repo.buy(G, A, "Fish")
    assert await repo.inventory(G, A) == [("Fish", 2)]
    assert await repo.balance(G, A) == 20
    assert await repo.inventory(G, B) == []


async def test_shop_buy_insufficient_funds_and_unknown_item(repo):
    await repo.add_item(G, "Crown", 500)
    await repo.add(G, A, 499)
    with pytest.raises(InsufficientFunds):
        await repo.buy(G, A, "Crown")
    assert await repo.balance(G, A) == 499 and await repo.inventory(G, A) == []
    with pytest.raises(EconomyError):
        await repo.buy(G, A, "nope")


async def test_concurrent_buys_cannot_double_spend(repo):
    await repo.add_item(G, "Fish", 60)
    await repo.add(G, A, 100)
    results = await asyncio.gather(*(repo.buy(G, A, "Fish") for _ in range(5)), return_exceptions=True)
    assert sum(not isinstance(r, Exception) for r in results) == 1
    assert await repo.balance(G, A) == 40


async def test_refund_purchase(repo):
    await repo.add_item(G, "Fish", 40)
    await repo.add(G, A, 100)
    item, _ = await repo.buy(G, A, "Fish")
    assert await repo.refund_purchase(G, A, item) == 100
    assert await repo.inventory(G, A) == []


def test_slots_payout():
    assert slots_payout(["🍒", "🍒", "🍒"], 10) == 40
    assert slots_payout(["🐱", "🐱", "🐱"], 10) == 1000
    assert slots_payout(["🍒", "🍒", "🍋"], 100) == 75  # pair returns 75%
    assert slots_payout(["🍒", "🍋", "🍒"], 100) == 75
    assert slots_payout(["🍒", "🍋", "🔔"], 100) == 0
    with pytest.raises(ValueError):
        slots_payout(["🍒", "🍒"], 10)


def test_spin_slots_is_deterministic_with_seed():
    assert spin_slots(random.Random(7)) == spin_slots(random.Random(7))
    assert len(spin_slots()) == 3


async def test_wager_requires_covering_the_stake_even_on_a_win(repo):
    with pytest.raises(InsufficientFunds):
        await repo.wager(G, A, 1_000, coinflip_net(1_000, True))
    assert await repo.balance(G, A) == 0
