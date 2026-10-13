from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import discord
import pytest

from nyan.cogs.core import PRIVACY_URL, REQUIRED_PERMISSIONS, TERMS_URL, Core, invite_url, missing_permissions

DOCS = Path(__file__).resolve().parent.parent / "docs"
CLIENT_ID = 1559417160596725830


def test_required_permissions_value():
    assert REQUIRED_PERMISSIONS.value == 1099780156438
    assert not REQUIRED_PERMISSIONS.administrator


def test_invite_url():
    url = invite_url(CLIENT_ID)
    query = parse_qs(urlparse(url).query)
    assert query["client_id"] == [str(CLIENT_ID)]
    assert query["permissions"] == ["1099780156438"]
    assert set(query["scope"][0].split()) == {"bot", "applications.commands"}
    assert "permissions=1099780156438" in url
    assert "permissions=8&" not in url + "&"


def test_readme_invite_matches_helper():
    readme = (DOCS.parent / "README.md").read_text(encoding="utf-8")
    assert "permissions=1099780156438" in readme
    assert "permissions=8" not in readme.replace("permissions=1099780156438", "")


def test_missing_permissions():
    assert missing_permissions(REQUIRED_PERMISSIONS) == []
    without_ban = discord.Permissions(REQUIRED_PERMISSIONS.value & ~discord.Permissions(ban_members=True).value)
    assert missing_permissions(without_ban) == ["ban_members"]
    assert missing_permissions(discord.Permissions(administrator=True)) == []
    assert set(missing_permissions(discord.Permissions.none())) == {n for n, v in REQUIRED_PERMISSIONS if v}


def test_core_cog_registers_commands():
    names = {c.name for c in Core.__cog_app_commands__}
    assert {"invite", "terms", "privacy"} <= names


def test_legal_urls():
    assert TERMS_URL == "https://pika-botinok223.github.io/nyan/terms.html"
    assert PRIVACY_URL == "https://pika-botinok223.github.io/nyan/privacy.html"


class _Collector(HTMLParser):
    VOID = {"meta", "link", "br", "img", "hr", "input"}

    def __init__(self):
        super().__init__()
        self.stack: list[str] = []
        self.errors: list[str] = []
        self.hrefs: list[str] = []
        self.tags: set[str] = set()
        self.text: list[str] = []

    def handle_starttag(self, tag, attrs):
        self.tags.add(tag)
        self.hrefs += [v for k, v in attrs if k in ("href", "src") and v]
        if tag not in self.VOID:
            self.stack.append(tag)

    def handle_endtag(self, tag):
        if not self.stack or self.stack[-1] != tag:
            self.errors.append(f"unexpected </{tag}> (open: {self.stack[-3:]})")
        else:
            self.stack.pop()

    def handle_data(self, data):
        self.text.append(data)


def parse(name: str) -> _Collector:
    parser = _Collector()
    parser.feed((DOCS / name).read_text(encoding="utf-8"))
    parser.close()
    return parser


@pytest.mark.parametrize("name", ["index.html", "terms.html", "privacy.html"])
def test_html_well_formed(name):
    raw = (DOCS / name).read_text(encoding="utf-8")
    assert raw.lower().startswith("<!doctype html>")
    parser = parse(name)
    assert parser.errors == []
    assert parser.stack == []
    assert "script" not in parser.tags
    assert "style.css" in parser.hrefs
    assert not [h for h in parser.hrefs if h.startswith("http") and "discord.com" not in h and "github.com" not in h]


@pytest.mark.parametrize("name", ["terms.html", "privacy.html"])
def test_legal_pages_have_date(name):
    assert "Last updated: October 13, 2026" in "".join(parse(name).text)


def test_privacy_lists_every_table():
    text = (DOCS / "privacy.html").read_text(encoding="utf-8")
    from nyan.economy.repo import SCHEMA as ECO
    from nyan.security.settings import SCHEMA as SEC

    import re

    for table in re.findall(r"CREATE TABLE IF NOT EXISTS (\w+)", ECO + SEC):
        assert f"<code>{table}</code>" in text


def test_index_links_legal_pages():
    hrefs = parse("index.html").hrefs
    assert "terms.html" in hrefs and "privacy.html" in hrefs
    assert any("permissions=1099780156438" in h for h in hrefs)


def test_docs_support_files():
    assert (DOCS / ".nojekyll").exists()
    css = (DOCS / "style.css").read_text(encoding="utf-8")
    assert "prefers-color-scheme: dark" in css
    assert "@import" not in css and "http" not in css
