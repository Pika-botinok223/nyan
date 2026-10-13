from __future__ import annotations

import os
from dataclasses import dataclass

from dotenv import load_dotenv


@dataclass(frozen=True)
class Config:
    token: str
    application_id: int | None
    dev_guild_id: int | None
    database_path: str


def _optional_int(name: str) -> int | None:
    value = os.getenv(name, "").strip()
    return int(value) if value else None


def load_config() -> Config:
    load_dotenv()
    token = os.getenv("DISCORD_TOKEN", "").strip()
    if not token:
        raise SystemExit("DISCORD_TOKEN is not set. Copy .env.example to .env and add your bot token.")
    return Config(
        token=token,
        application_id=_optional_int("APPLICATION_ID"),
        dev_guild_id=_optional_int("DEV_GUILD_ID"),
        database_path=os.getenv("DATABASE_PATH", "nyan.db").strip() or "nyan.db",
    )
