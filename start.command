#!/bin/bash
# nyan launcher for macOS: double-click this file in Finder.
# First run: sets everything up. Later runs: just starts the bot.

set -u

# Work from the folder this file lives in (works when double-clicked, and with spaces in the path).
cd "$(dirname "$0")" || { echo "Could not open the nyan folder."; printf 'Press Enter to close this window...'; read -r _; exit 1; }

pause_and_exit() {
    echo
    printf 'Press Enter to close this window...'
    read -r _
    exit "${1:-0}"
}

# Prints a hash of a file (SHA-256 if available, otherwise cksum).
hash_file() {
    if command -v shasum >/dev/null 2>&1; then
        shasum -a 256 "$1" | cut -d ' ' -f 1
    else
        cksum "$1" | cut -d ' ' -f 1,2
    fi
}

# Opens .env in TextEdit (plain text) so the token can be pasted.
open_env() {
    open -e .env 2>/dev/null || echo "Please open the file named .env in this folder with a text editor."
}

echo "=== nyan launcher ==="

# 1. Python
if ! command -v python3 >/dev/null 2>&1; then
    echo "Python 3 was not found on this Mac."
    echo "Install it from https://www.python.org/downloads/ (or run: xcode-select --install),"
    echo "then double-click start.command again."
    pause_and_exit 1
fi
if ! python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' >/dev/null 2>&1; then
    echo "Your Python 3 is missing or older than 3.9."
    echo "Install a newer one from https://www.python.org/downloads/ (or run: xcode-select --install),"
    echo "then double-click start.command again."
    pause_and_exit 1
fi

# 2. Virtual environment
if [ ! -x .venv/bin/python ]; then
    echo "Creating the virtual environment (.venv), first run only..."
    rm -rf .venv
    if ! python3 -m venv .venv; then
        rm -rf .venv
        echo
        echo "Could not create the virtual environment."
        echo "Try installing Python from https://www.python.org/downloads/ (or run: xcode-select --install)."
        pause_and_exit 1
    fi
fi

# 3. Dependencies (only when requirements.txt changed since the last successful install)
if [ ! -f requirements.txt ]; then
    echo "requirements.txt is missing. Is this the full nyan folder?"
    pause_and_exit 1
fi
current_hash="$(hash_file requirements.txt)"
saved_hash=""
if [ -f .venv/.requirements.sha256 ]; then
    saved_hash="$(cat .venv/.requirements.sha256)"
fi
if [ -z "$current_hash" ] || [ "$current_hash" != "$saved_hash" ]; then
    echo "Installing requirements (this can take a minute)..."
    if .venv/bin/python -m pip install -q --upgrade pip && .venv/bin/python -m pip install -r requirements.txt; then
        echo "$current_hash" > .venv/.requirements.sha256
    else
        echo
        echo "Installing the requirements failed. Check your internet connection and try again."
        echo "If it keeps failing, delete the .venv folder and double-click start.command again."
        pause_and_exit 1
    fi
fi

# 4. Bot token
if [ ! -f .env ]; then
    if [ ! -f .env.example ]; then
        echo ".env.example is missing. Is this the full nyan folder?"
        pause_and_exit 1
    fi
    cp .env.example .env
    echo
    echo "I created a file called .env for you and opened it in TextEdit."
    echo "Paste your bot token after DISCORD_TOKEN= in the .env file that just opened,"
    echo "save it (Cmd+S), then double-click start.command again."
    open_env
    pause_and_exit 0
fi
if ! grep -Eq '^DISCORD_TOKEN=.+' .env; then
    echo
    echo "No bot token found in .env."
    echo "Paste your bot token after DISCORD_TOKEN= in the .env file that just opened,"
    echo "save it (Cmd+S), then double-click start.command again."
    open_env
    pause_and_exit 0
fi

# 5. Run
echo
echo "Starting nyan... (press Ctrl+C or close this window to stop)"
echo
.venv/bin/python -m nyan
status=$?
echo
if [ "$status" -eq 0 ]; then
    echo "nyan stopped."
else
    echo "nyan stopped with an error (exit code $status). See the messages above."
fi
pause_and_exit "$status"
