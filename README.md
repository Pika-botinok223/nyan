# nyan 🐾

A cat-themed Discord bot with server protection and fun toys.

- **Anti-raid**: detects join floods, auto-lockdown, flags brand-new accounts
- **Anti-scam**: catches phishing/lookalike links (`dlscord.gift`, `steamcommunlty.com`, …), fake "free nitro" posts and masked links; per-server block/allow lists
- **Anti-spambot (honeypot)**: a "do not post here" trap channel that bans bots posting in it, and a cross-channel duplicate-spam detector
- **Economy**: per-server currency, `/daily`, `/work`, `/pay`, gambling, leaderboard, and a role shop
- **Toys**: `/8ball`, `/roll`, `/choose`, `/cat`, `/rps`, `/hug`, `/pat`, …

Run `/help` in Discord for the full command list. `/invite`, `/terms` and `/privacy` give you the invite link and the legal pages.

## Setup

1. In the [Developer Portal](https://discord.com/developers/applications) open the app → **Bot**:
   - Click **Reset Token** and copy the token.
   - Enable the **Server Members Intent** and **Message Content Intent**.
2. Invite the bot (replace the client ID if you use another app):

   ```
   https://discord.com/oauth2/authorize?client_id=1559417160596725830&scope=bot+applications.commands&permissions=1099780156438
   ```

   That link (scopes `bot applications.commands`) asks only for the permissions nyan actually uses. `/invite` in Discord prints the same link.

   | Permission | Used for |
   | --- | --- |
   | View Channels, Read Message History | seeing the messages it protects |
   | Send Messages, Embed Links | replies and mod-log reports |
   | Manage Messages | deleting scam, spam and honeypot messages |
   | Kick Members | anti-raid lockdown kicks |
   | Ban Members | honeypot bans / softbans |
   | Moderate Members | timeouts (anti-scam, spam, anti-raid) |
   | Manage Roles | shop role rewards |
   | Manage Channels | `/honeypot setup` creates the trap channel |

   Put nyan's role **above** the roles it should moderate or hand out from the shop, because Discord's role hierarchy always applies. If nyan is added with some of these missing, it posts a notice listing what won't work.
3. Run it (Python 3.9 or newer; on macOS use `python3`):

   ```bash
   python3 -m venv .venv && source .venv/bin/activate
   pip install -r requirements.txt
   cp .env.example .env   # then paste your token into DISCORD_TOKEN
   python -m nyan
   ```

   Set `DEV_GUILD_ID` in `.env` to have slash commands show up instantly in one test server. Global sync can take up to an hour.

### Easiest on macOS: double-click `start.command`

Instead of typing the commands above, double-click `start.command` in Finder (it needs Python 3.9+, see [python.org](https://www.python.org/downloads/)).

- **First run:** it creates the `.venv`, installs the requirements, and opens `.env` in TextEdit. Paste your bot token after `DISCORD_TOKEN=`, save, and double-click `start.command` again.
- **Later runs:** it just starts the bot (requirements are reinstalled only if `requirements.txt` changed). Press Ctrl+C or close the window to stop it.
- **"can't be opened because it is from an unidentified developer":** right-click `start.command` → **Open** → **Open** (only needed once). Or, in Terminal from the nyan folder: `xattr -d com.apple.quarantine start.command`.
- **"permission denied":** in Terminal from the nyan folder, run `chmod +x start.command`.

## First steps in your server

Run these as someone with **Manage Server**:

1. `/security modlog #mod-log` so nyan has somewhere to report what it did.
2. `/honeypot setup` creates `#do-not-post-here`. Humans read the warning and stay out. Spambots post there and get banned, and their last 24h of messages are purged.
3. `/security status` shows what is on. Use `/security toggle` to enable or disable a module.
4. Tune the protection if needed: `/antiraid config` (default is 8 joins in 10s → 10 min lockdown, new joiners kicked) and `/antiscam block|allow <domain>`.
5. Optional: `/economy config` to rename the currency, and `/shop add` to sell roles.

Owners, admins and anyone with Manage Messages are never punished by the automod. Lockdown state is kept in memory, so a restart ends an active lockdown.

## Legal

- [Terms of Service](https://pika-botinok223.github.io/nyan/terms.html)
- [Privacy Policy](https://pika-botinok223.github.io/nyan/privacy.html)

The pages are plain static HTML in [`docs/`](docs/) (no scripts, no trackers).

**For the bot owner:**

1. Enable GitHub Pages (one-time): repo **Settings → Pages → Build and deployment → Source: Deploy from a branch**, branch `claude/elegant-fermi-av7s49` (or `main` if you merge into it), folder **`/docs`**. GitHub republishes the site on every push.
2. In the [Developer Portal](https://discord.com/developers/applications) open the app → **General Information** and paste the two URLs above into **Terms of Service URL** and **Privacy Policy URL**.
3. If you change what the bot stores or processes, update `docs/privacy.html` (and its "Last updated" date) in the same change.

## Development

```bash
pip install -r requirements-dev.txt
pytest
```

Layout: `nyan/cogs/` holds the Discord command modules. Each one is auto-loaded. `nyan/security/` and `nyan/economy/` hold the pure logic that the tests cover.
