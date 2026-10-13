import logging

import discord

from .bot import NyanBot
from .config import load_config


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    config = load_config()
    bot = NyanBot(config)
    try:
        bot.run(config.token, log_handler=None)
    except discord.LoginFailure:
        raise SystemExit(
            "Discord rejected the token. Check DISCORD_TOKEN in .env (Developer Portal -> Bot -> Reset Token)."
        ) from None
    except discord.PrivilegedIntentsRequired:
        raise SystemExit(
            "Enable the privileged intents: Developer Portal -> your app -> Bot -> turn on "
            "'Server Members Intent' and 'Message Content Intent', save, then start nyan again."
        ) from None


if __name__ == "__main__":
    main()
