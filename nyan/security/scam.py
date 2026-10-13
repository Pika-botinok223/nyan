from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

# Domains Discord/Steam legitimately use. Subdomains (cdn.discordapp.com, ...) are legit too.
LEGIT_DOMAINS: tuple[str, ...] = (
    "discord.com",
    "discord.gg",
    "discordapp.com",
    "discord.media",
    "discord.gift",
    "discord.new",
    "discord.co",
    "discord.dev",
    "discord.design",
    "discordapp.net",
    "discordstatus.com",
    "dis.gd",
    "steamcommunity.com",
    "steampowered.com",
    "steamstatic.com",
)
# Well-known third-party Discord community sites that would otherwise trip the brand/typo rules.
COMMUNITY_DOMAINS: tuple[str, ...] = (
    "discord.me",
    "discords.com",
    "discord.st",
    "discord.bio",
    "discordservers.com",
    "discordbotlist.com",
)
# Second-level labels that scammers imitate (checked against *any* TLD that is not a legit domain).
BRAND_LABELS: tuple[str, ...] = ("discord", "discordapp", "steamcommunity", "steampowered")
# Words that, combined with "discord"/"steam" in a domain label, make it a phishing candidate.
BAIT_WORDS: tuple[str, ...] = (
    "nitro", "gift", "gifts", "free", "promo", "airdrop", "give", "giveaway", "claim", "bonus",
    "drop", "trade", "verify", "support", "event", "events", "reward", "rewards", "login", "app",
)  # fmt: skip

SECOND_LEVEL_SLDS = {"co", "com", "org", "net", "gov", "edu", "ac"}
# "Domains" that are really file names: never treat a bare ``foo.png`` as a link.
FILE_EXTENSIONS = frozenset(
    "png jpg jpeg gif webp bmp svg ico mp3 mp4 mov avi mkv wav ogg txt md json yaml yml toml ini cfg log csv "
    "py js ts jsx tsx css html htm php rb go rs java kt c h cpp cs sh bat exe dll zip rar tar gz bz2 pdf doc docx "
    "xls xlsx ppt pptx".split()
)  # fmt: skip

_CONFUSABLES = str.maketrans(
    {
        "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "х": "x", "у": "y", "і": "i", "ј": "j",
        "ѕ": "s", "ԁ": "d", "ӏ": "l", "ɑ": "a", "ɡ": "g", "ı": "i", "ο": "o", "ν": "v", "α": "a",
        "ρ": "p", "ι": "i", "κ": "k", "τ": "t", "ɩ": "i", "І": "i", "О": "o", "Е": "e", "А": "a",
    }
)  # fmt: skip
# Characters that look alike after the above: i/l/1/| are one class, 0->o, etc.
_LOOKALIKE = str.maketrans({"i": "l", "1": "l", "|": "l", "!": "l", "0": "o", "3": "e", "5": "s", "$": "s", "4": "a", "@": "a"})


def skeleton(text: str) -> str:
    """Collapse visually confusable characters/sequences so ``dlscord`` and ``discorcl`` map onto ``discord``."""
    text = unicodedata.normalize("NFKD", text.lower())
    text = "".join(c for c in text if not unicodedata.combining(c)).translate(_CONFUSABLES)
    text = text.replace("-", "").replace("rn", "m").replace("vv", "w").replace("cl", "d")
    return text.translate(_LOOKALIKE)


def edit_distance(a: str, b: str) -> int:
    """Damerau-Levenshtein (optimal string alignment): swaps count as one edit."""
    prev2: list[int] = []
    prev = list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        cur = [i] + [0] * len(b)
        for j in range(1, len(b) + 1):
            cost = a[i - 1] != b[j - 1]
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
            if i > 1 and j > 1 and a[i - 1] == b[j - 2] and a[i - 2] == b[j - 1]:
                cur[j] = min(cur[j], prev2[j - 2] + 1)
        prev2, prev = prev, cur
    return prev[len(b)]


# --------------------------------------------------------------------------- link extraction


@dataclass(frozen=True)
class Link:
    raw: str
    host: str
    path: str
    explicit: bool  # had a scheme / www.


_TOKEN = re.compile(r"[^\s<>()\[\]|\"'`]+")
_HOST = re.compile(r"^(?:[^\W_](?:[\w-]*[^\W_])?\.)+[^\W\d_]{2,24}$")
_EDGE = ".,;:!?*_~"


def _split_host(token: str) -> tuple[str, str]:
    rest = re.sub(r"^[a-z][a-z0-9+.-]*://", "", token, flags=re.I)
    m = re.match(r"([^/?#]*)(.*)", rest, flags=re.S)
    authority, path = (m.group(1), m.group(2)) if m else (rest, "")
    authority = authority.rsplit("@", 1)[-1]  # strip userinfo: https://discord.com@evil.ru -> evil.ru
    host = re.sub(r":\d*$", "", authority).strip(".").lower()
    return host, path


def _decode_idna(host: str) -> str:
    if "xn--" not in host:
        return host
    try:
        return host.encode("ascii").decode("idna")
    except (UnicodeError, ValueError):
        return host


def extract_links(text: str) -> list[Link]:
    links: list[Link] = []
    for match in _TOKEN.finditer(text):
        token = match.group().strip(_EDGE)
        if not token or token.startswith("@"):
            continue
        explicit = bool(re.match(r"(?i)^(?:https?://|www\.)", token))
        if explicit:
            host, path = _split_host(token)
        else:
            if "@" in token:  # e-mail address
                continue
            host, path = _split_host(token)
            if not _HOST.match(host) or host.rsplit(".", 1)[-1] in FILE_EXTENSIONS:
                continue
        if "." not in host:
            continue
        links.append(Link(token, _decode_idna(host), path, explicit))
    return links


def registrable(host: str) -> str:
    parts = host.split(".")
    if len(parts) >= 3 and len(parts[-1]) == 2 and parts[-2] in SECOND_LEVEL_SLDS:
        return ".".join(parts[-3:])
    return ".".join(parts[-2:])


def host_matches(host: str, domain: str) -> bool:
    return host == domain or host.endswith("." + domain)


def normalize_domain(text: str) -> str | None:
    """Turn admin input (``https://www.Evil.com/x``) into a bare lowercase domain, or None if invalid."""
    text = text.strip().strip("<>")
    host, _ = _split_host(text)
    if host.startswith("www."):
        host = host[4:]
    host = _decode_idna(host)
    return host if "." in host and _HOST.match(host) else None


# --------------------------------------------------------------------------- host checks


_BAIT_SKELETONS = tuple(sorted({skeleton(w) for w in BAIT_WORDS}, key=len, reverse=True))
_DISCORD, _STEAM = skeleton("discord"), skeleton("steam")


def _all_bait(s: str) -> bool:
    """True if ``s`` is non-empty and made up entirely of (skeletonised) bait words, e.g. ``giftnitro``."""
    while s:
        for word in _BAIT_SKELETONS:
            if s.startswith(word):
                s = s[len(word) :]
                break
        else:
            return False
    return True


def _brand_plus_bait(label_skel: str) -> bool:
    """``label_skel`` is a skeletonised label (hyphens already removed)."""
    if _DISCORD in label_skel:
        rest = label_skel.replace(_DISCORD, "")
        return any(w in rest for w in _BAIT_SKELETONS)
    if label_skel.startswith(_STEAM):
        return _all_bait(label_skel[len(_STEAM) :])
    if label_skel.endswith(_STEAM):
        return _all_bait(label_skel[: -len(_STEAM)])
    return False


def is_legit_host(host: str) -> bool:
    return any(host_matches(host, d) for d in LEGIT_DOMAINS)


def is_invite(link: Link) -> bool:
    if host_matches(link.host, "discord.gg") or host_matches(link.host, "dis.gd"):
        return True
    return link.host in ("discord.com", "www.discord.com", "discordapp.com") and link.path.lower().startswith("/invite")


def check_host(host: str, blocked: frozenset[str] | set[str] = frozenset(), allowed: frozenset[str] | set[str] = frozenset()) -> str | None:
    """Return a reason string if ``host`` looks like a scam domain, else None."""
    if any(host_matches(host, d) for d in allowed) or any(host_matches(host, d) for d in COMMUNITY_DOMAINS):
        return None
    for d in blocked:
        if host_matches(host, d):
            return f"blocked domain `{d}`"
    if is_legit_host(host):
        return None
    for legit in LEGIT_DOMAINS:
        if legit + "." in host + ".":
            return f"`{host}` embeds `{legit}` but is not Discord/Steam"

    rd = registrable(host)
    label = rd.split(".")[0]
    rd_skel, label_skel = skeleton(rd), skeleton(label)
    for legit in LEGIT_DOMAINS:
        if rd_skel == skeleton(legit):
            return f"lookalike of `{legit}` (`{rd}`)"
    for brand in BRAND_LABELS:
        b = skeleton(brand)
        if label_skel == b:
            return f"imitates `{brand}` on an unofficial domain (`{rd}`)"
        if len(b) >= 7 and edit_distance(label_skel, b) == 1:
            return f"typo-squat of `{brand}` (`{rd}`)"
    if _brand_plus_bait(label_skel):
        return f"suspicious Discord/Steam-themed domain `{rd}`"
    return None


# --------------------------------------------------------------------------- message scan

_BAIT_PATTERNS = [
    r"\bfree\s+(?:discord\s+)?nitro\b",
    r"\bnitro\s+(?:gift|giveaway|for\s+free|free)\b",
    r"\b(?:gift|giving|giveaway|distribut\w*|claim)\b.{0,30}\bnitro\b",
    r"\bnitro\b.{0,30}\b(?:gift|giveaway|claim|airdrop)\b",
    r"\bsteam\b.{0,20}\b(?:gift|giveaway|wallet|code)\b",
    r"\bairdrop\b",
    r"\b(?:gifted|gifts)\s+you\b",
    r"\bclaim\s+(?:your\s+)?(?:free|gift|reward|prize)",
    r"\b(?:3|three)\s+months?\s+(?:of\s+)?nitro",
    r"\bfree\s+(?:steam|cs\s?go|cs2|skins?|robux|gift\s*card)",
]
BAIT_RE = re.compile("|".join(_BAIT_PATTERNS), re.I | re.S)
_MASKED = re.compile(r"\[([^\]\n]{1,200})\]\(\s*<?([^)\s>]+)>?(?:\s+\"[^\"]*\")?\s*\)")
_USERINFO_TRICK = re.compile(r"(?i)^https?://[^/@\s]*\.[a-z]{2,}[^/@\s]*@")  # https://discord.com@evil.ru
_MASS_PING = re.compile(r"@(?:everyone|here)\b")


@dataclass(frozen=True)
class ScamVerdict:
    reasons: tuple[str, ...] = ()

    @property
    def flagged(self) -> bool:
        return bool(self.reasons)

    def __str__(self) -> str:
        return "; ".join(self.reasons)


def scan_message(
    content: str,
    *,
    blocked: frozenset[str] | set[str] = frozenset(),
    allowed: frozenset[str] | set[str] = frozenset(),
    mentions_everyone: bool = False,
) -> ScamVerdict:
    """Scan a message for scam patterns. Pure function: no Discord objects involved."""
    reasons: list[str] = []

    def add(reason: str) -> None:
        if reason not in reasons:
            reasons.append(reason)

    links = extract_links(content)
    external = False  # any link that is not allowlisted / official Discord (invites count as external)
    for link in links:
        if _USERINFO_TRICK.match(link.raw):
            add(f"deceptive link `{link.raw[:60]}` (real host is `{link.host}`)")
            external = True
        if any(host_matches(link.host, d) for d in allowed):
            continue
        reason = check_host(link.host, blocked, allowed)
        if reason:
            add(reason)
        if reason or not is_legit_host(link.host) or is_invite(link):
            external = True

    text = unicodedata.normalize("NFKC", content)
    if external and BAIT_RE.search(text):
        add("free nitro/gift bait with a link")
    if external and (mentions_everyone or _MASS_PING.search(text)):
        add("@everyone/@here ping with a link")

    for m in _MASKED.finditer(content):
        shown = extract_links(m.group(1))
        target = extract_links(m.group(2))
        if not shown or not target:
            continue
        if any(host_matches(target[0].host, d) for d in allowed):
            continue
        if registrable(shown[0].host) != registrable(target[0].host):
            add(f"masked link shows `{shown[0].host}` but goes to `{target[0].host}`")
    return ScamVerdict(tuple(reasons))
