# Paperboy

A pixel-art Paperboy clone for the browser. Everything is generated at runtime: the sprites are drawn from code (`sprites.js`) and all sound effects and chiptune music are synthesized with the Web Audio API (`audio.js`). No build step, no asset files.

```sh
cd paperboy
python3 -m http.server 8000
# open http://localhost:8000/
```

**Controls:** arrows/WASD to steer and change speed, Space/Z/J to throw left, P/Esc to pause, M to mute, Enter to start. On-screen buttons appear on touch devices (or add `?touch` to the URL).

Deliver to the bright subscriber houses (mailbox 250, porch 100), smash the gloomy non-subscribers' windows for bonus points, and survive Monday through Sunday. Missed subscribers cancel the next day.

See `CONTRACT.md` for the interface between the art/audio modules and the game.
