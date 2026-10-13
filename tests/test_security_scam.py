from __future__ import annotations

import pytest

from nyan.security.scam import check_host, edit_distance, extract_links, normalize_domain, scan_message, skeleton


def flagged(text: str, **kw) -> bool:
    return scan_message(text, **kw).flagged


@pytest.mark.parametrize(
    "text",
    [
        "check this out https://discord.com/channels/1/2/3",
        "join https://discord.gg/nyan",
        "https://cdn.discordapp.com/attachments/1/2/cat.png",
        "https://media.discordapp.net/attachments/1/2/cat.png",
        "https://steamcommunity.com/id/someone",
        "store.steampowered.com/app/440",
        "docs at https://discordpy.readthedocs.io/en/stable/ and https://github.com/Rapptz/discord.py",
        "https://discord.js.org/docs",
        "[Discord](https://discord.com/developers) is fine",
        "[click here](https://example.org/page)",
        "free nitro is a scam, don't click links like that",  # bait text but no link
        "@everyone game night at 8!",  # ping but no link
        "see https://discord.com/nitro, free nitro trial https://discord.com/nitro",  # official link only
        "mail me at someone@gmail.com or open main.py and image.png",
        "i love discord and steam. e.g. this",
        "https://youtu.be/dQw4w9WgXcQ",
    ],
)
def test_legit_messages_not_flagged(text):
    assert not flagged(text), scan_message(text).reasons


@pytest.mark.parametrize(
    "text",
    [
        "https://dlscord.com/gift",
        "https://discorcl.gift/abc",
        "http://discorcl-nitro.com",
        "https://discrod.com/login",  # transposition typo
        "steamcommunlty.com/tradeoffer/new",
        "https://steamcornmunity.com/login",  # rn -> m
        "https://discоrd.com/x",  # cyrillic o
        "https://dіscord.com/x",  # cyrillic i
        "discord.xyz/nitro",
        "https://discord.com.free-nitro.ru/claim",
        "https://discord.com@evil.ru/x",
        "get it at steam-gift.com",
        "discordnitro-free.com",
    ],
)
def test_lookalikes_flagged(text):
    assert flagged(text), text


def test_check_host_reasons():
    assert "lookalike" in check_host("dlscord.com")
    assert "typo-squat" in check_host("discrod.com")
    assert check_host("discord.com") is None
    assert check_host("cdn.discordapp.com") is None
    assert check_host("steamcommunity.com") is None
    assert check_host("example.com") is None


def test_free_nitro_with_link():
    v = scan_message("FREE NITRO for everyone!! claim at https://my-promo.example.net/n")
    assert v.flagged and any("bait" in r for r in v.reasons)
    assert flagged("Steam gift card giveaway https://totally-legit.ru")
    assert flagged("free nitro https://discord.gg/abcdef")  # invites still count as a link
    assert not flagged("Free nitro? lol no thanks")


def test_everyone_with_link():
    assert flagged("@everyone check https://some-site.ru/x")
    assert flagged("hi", mentions_everyone=True) is False  # no link
    assert flagged("hi https://some-site.ru", mentions_everyone=True)
    assert flagged("@here https://discord.gg/invite")
    assert not flagged("@everyone docs https://discord.com/developers/docs")


def test_masked_links():
    v = scan_message("[discord.com/nitro](https://evil.example/claim)")
    assert any("masked" in r for r in v.reasons)
    assert flagged("[https://steamcommunity.com/gift](https://evil.example)")
    assert not flagged("[discord.com](https://discord.com/app)")
    assert not flagged("[docs](https://example.org/docs)")
    assert not flagged("[cdn](https://cdn.discordapp.com/x.png) [discord.com](https://support.discord.com/hc)")


def test_blocklist_and_allowlist():
    assert "blocked" in scan_message("https://evil.com/x", blocked=frozenset({"evil.com"})).reasons[0]
    assert flagged("sub.evil.com/a", blocked=frozenset({"evil.com"}))
    assert not flagged("notevil.com/a", blocked=frozenset({"evil.com"}))
    # allowlisted domains are never flagged, even lookalikes (e.g. discord.me server list)
    assert not flagged("https://discord.xyz/server", allowed=frozenset({"discord.xyz"}))
    assert not flagged("free nitro https://partner.example", allowed=frozenset({"partner.example"}))
    assert not flagged("@everyone https://partner.example", allowed=frozenset({"partner.example"}))


def test_helpers():
    assert skeleton("DlScorcl") == skeleton("discord")
    assert edit_distance("discord", "discrod") == 1
    assert edit_distance("abc", "xyz") == 3
    assert normalize_domain("https://www.Evil.COM/path?q=1") == "evil.com"
    assert normalize_domain("evil.com") == "evil.com"
    assert normalize_domain("not a domain") is None
    assert normalize_domain("localhost") is None
    hosts = [l.host for l in extract_links("see (https://a.example/x), <https://b.example> and c.example.org/p. image.png")]
    assert hosts == ["a.example", "b.example", "c.example.org"]


@pytest.mark.parametrize("url", ["https://discord.me/server", "https://discords.com/servers/1", "https://discordbotlist.com/bots/x"])
def test_known_community_sites_not_flagged(url):
    assert not scan_message(url).flagged
