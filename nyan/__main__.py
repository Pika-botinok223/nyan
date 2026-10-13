import logging

from .bot import NyanBot
from .config import load_config


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    config = load_config()
    bot = NyanBot(config)
    bot.run(config.token, log_handler=None)


if __name__ == "__main__":
    main()
