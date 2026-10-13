# nyan 🐾

A cat-themed Discord bot with server protection and fun toys.

- **Anti-raid**: detects join floods, auto-lockdown, flags brand-new accounts
- **Anti-scam**: catches phishing/lookalike links (`dlscord.gift`, `steamcommunlty.com`, …), fake "free nitro" posts and masked links; per-server block/allow lists
- **Anti-spambot (honeypot)**: a "do not post here" trap channel that bans bots posting in it, and a cross-channel duplicate-spam detector
- **Economy**: per-server currency, `/daily`, `/work`, `/pay`, gambling, leaderboard, and a role shop
- **Toys**: `/8ball`, `/roll`, `/choose`, `/cat`, `/rps`, `/hug`, `/pat`, …

Run `/help` in Discord for the full command list.

## Setup

1. In the [Developer Portal](https://discord.com/developers/applications) open the app → **Bot**:
   - Click **Reset Token** and copy the token.
   - Enable the **Server Members Intent** and **Message Content Intent**.
2. Invite the bot (replace the client ID if you use another app):

   ```
   https://discord.com/oauth2/authorize?client_id=1559417160596725830&scope=bot+applications.commands&permissions=1099780156438
   ```

   That link asks for: Manage Roles, Manage Channels, Kick Members, Ban Members, Moderate Members (timeout), View Channels, Send Messages, Manage Messages, Embed Links, Read Message History. Put nyan's role **above** the roles it should moderate or hand out from the shop.
3. Run it (Python 3.10+):

   ```bash
   python -m venv .venv && source .venv/bin/activate
   pip install -r requirements.txt
   cp .env.example .env   # then paste your token into DISCORD_TOKEN
   python -m nyan
   ```

   Set `DEV_GUILD_ID` in `.env` to have slash commands show up instantly in one test server. Global sync can take up to an hour.

## Development

```bash
pip install -r requirements-dev.txt
pytest
```

Layout: `nyan/cogs/` holds the Discord command modules. Each one is auto-loaded. `nyan/security/` and `nyan/economy/` hold the pure logic that the tests cover.
