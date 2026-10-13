# Paperboy — module contract

A pixel-art Paperboy clone that runs in the browser with no build step and no
external files: all art is drawn from code and all sound is synthesized with
the Web Audio API. Three plain scripts, loaded in this order by `index.html`:

| File | Owner | Global it defines |
| --- | --- | --- |
| `sprites.js` | assets agent | `window.Sprites` |
| `audio.js`   | assets agent | `window.Sfx` |
| `game.js`    | coding agent | (none required) |
| `index.html`, `style.css` (optional) | coding agent | |

No modules, no bundler, no CDN, no image/audio files. Plain ES2020, works when
served by `python3 -m http.server` from this folder.

## Screen

- Internal resolution **256 × 240** logical pixels (NES-like), drawn on one
  `<canvas>` and scaled up by an integer factor with
  `image-rendering: pixelated` and `ctx.imageSmoothingEnabled = false`.
- View is **top-down / 3/4 view, scrolling vertically**: the paperboy rides
  **up** the screen. Houses sit on the **left**, then lawn, then the sidewalk,
  then the road on the right. Papers are thrown **to the left** at the houses.
- Every sprite is drawn as seen from above with a slight 3/4 tilt (you see the
  roof and the street-facing **right** side / front of things).

## `window.Sprites` (sprites.js)

```js
Sprites.init()                    // synchronous; builds all canvases. Idempotent.
Sprites.get(name, frame = 0)      // -> HTMLCanvasElement (frame wraps modulo count)
Sprites.frames(name)              // -> number of frames for that name
Sprites.draw(ctx, name, x, y, frame = 0, flipX = false) // draws at integer x,y (top-left)
Sprites.size(name)                // -> {w, h}
Sprites.drawText(ctx, text, x, y, color = '#fff', scale = 1, align = 'left')
                                  // 5x7 bitmap font (A–Z, 0–9, space, . , ! ? : - + / ' x % and ❤ via '@').
                                  // align: 'left' | 'center' | 'right'. Lower case is drawn as upper case.
Sprites.textWidth(text, scale = 1) // -> pixel width (6 px per char incl. 1px spacing, * scale)
Sprites.PALETTE                   // object of named hex colours used by the art
Sprites.meta                      // per-sprite hit/overlay data, see below
```

Transparent pixels are fully transparent. Sizes below are **exact** — the game
lays out by them.

| name | size (w×h) | frames | notes |
| --- | --- | --- | --- |
| `paperboy` | 16×24 | 4 | on bicycle riding up, pedalling cycle |
| `paperboy_throw` | 16×24 | 2 | arm out to the left (frame 0 wind-up, 1 release) |
| `paperboy_crash` | 24×24 | 3 | tumble / fallen off the bike |
| `paper` | 8×8 | 4 | rolled newspaper spinning |
| `paper_bundle` | 12×10 | 1 | pickup: tied stack of papers |
| `house_sub` | 96×80 | 1 | subscriber house: bright, cheerful colours, clean lawn feel |
| `house_nonsub` | 96×80 | 1 | non-subscriber: dark/grey, gloomy, cracked |
| `window` | 10×10 | 1 | intact window, drawn over the house at `meta.house.windows` |
| `window_broken` | 10×10 | 1 | smashed glass |
| `door` | 12×16 | 1 | front door, drawn at `meta.house.door` |
| `mailbox` | 8×12 | 1 | on a post |
| `mailbox_hit` | 8×12 | 1 | flag up / paper sticking out |
| `mailbox_broken` | 8×12 | 1 | knocked over (for non-subscribers) |
| `car` | 20×32 | 2 | top-down car driving down the road toward the player, headlights flicker |
| `dog` | 16×12 | 2 | running dog, faces right (game flips for left) |
| `skater` | 12×20 | 2 | kid on a skateboard |
| `worker` | 12×20 | 2 | breakdancer / roadworker, fun extra pedestrian |
| `hydrant` | 8×10 | 1 | |
| `trashcan` | 10×12 | 1 | |
| `tree` | 24×32 | 1 | round canopy |
| `bush` | 16×12 | 1 | |
| `fence` | 16×8 | 1 | tileable horizontally |
| `grass` | 16×16 | 2 | tileable lawn tile (2 variants) |
| `grass_dead` | 16×16 | 1 | brown lawn for non-subscribers |
| `sidewalk` | 16×16 | 1 | tileable concrete slab |
| `road` | 16×16 | 1 | asphalt |
| `road_line` | 16×16 | 1 | asphalt with dashed centre line segment |
| `curb` | 4×16 | 1 | vertical curb strip between sidewalk and road |
| `driveway` | 16×16 | 1 | |
| `flowers` | 16×16 | 1 | decorative flower bed (transparent background) |
| `icon_paper` | 8×8 | 1 | HUD paper count |
| `icon_life` | 8×8 | 1 | HUD life (paperboy head) |
| `icon_house` | 8×8 | 1 | HUD subscriber count |
| `logo` | 160×40 | 1 | "PAPERBOY" title graphic |

`Sprites.meta.house = { windows: [{x,y,w:10,h:10}, {x,y,w:10,h:10}], door: {x,y,w:12,h:16}, porch: {x,y,w,h} }`
— offsets relative to the house sprite's top-left; the windows, door and porch
are on the street-facing right half of the house so a paper thrown left from
the sidewalk can hit them. The house sprite itself paints the wall behind
them (no hole needed). `porch` is the doorstep landing zone in front of the
door.

## `window.Sfx` (audio.js)

All Web Audio, synthesized at runtime (oscillators, noise buffers, envelopes);
no samples. Browsers require a user gesture, so the game calls `Sfx.init()`
from its first keydown/pointerdown. Every method must be a safe no-op before
`init()` or when Web Audio is unavailable — never throw.

```js
Sfx.init()                 // create/resume AudioContext
Sfx.play(name)             // one-shot effect
Sfx.music(track)           // start a looping chiptune track, replacing any current one; null stops
Sfx.stopMusic()
Sfx.setMuted(bool)
Sfx.toggleMute()           // -> new muted state
Sfx.muted                  // boolean
```

SFX names: `throw`, `mailbox` (bullseye delivery, bright ding), `porch`
(thud on the doorstep), `glass` (window smash), `crash` (paperboy wipes out),
`pickup` (paper bundle), `bark`, `horn`, `skid`, `bump` (paper hits wall/obstacle),
`select` (menu), `start`, `day_clear` (end-of-day jingle), `game_over`,
`extra_life`, `cancel` (subscriber cancels, sad blip).

Music tracks (looping, NES-style: 2 pulse channels + triangle bass + noise drums,
scheduled ahead with the AudioContext clock, not setInterval-timed notes):
`title`, `ride` (main upbeat in-game theme, at least 16 bars before repeating),
`summary` (calm, end-of-day screen), `gameover` (short, non-looping or slow loop).
Music volume sits under the SFX.

## Gameplay (game.js)

- One **week**: Monday → Sunday is 7 levels ("days"). Each day is a street of
  ~20 houses scrolling past; the route gets faster and busier each day.
- Start of game: 10 of the 20 houses on the street are subscribers (random),
  3 lives, 10 papers.
- Deliver to a subscriber: paper into the **mailbox** = 250, onto the **porch**
  = 100. A subscriber who gets no paper (or gets a window broken) **cancels**
  and becomes a non-subscriber the next day.
- Non-subscribers: break their windows for 50 each, knock their mailbox for 100.
- A perfect day (every subscriber delivered) wins back one cancelled house as a
  new subscriber and gives a bonus.
- Obstacles: cars on the road, dogs, skaters, workers, hydrants, trash cans,
  trees, bushes, fences. Hitting one = crash (lose a life, brief respawn).
- Pick up `paper_bundle`s on the sidewalk to refill (+10 papers, max 20).
- Game over when lives run out or there are no subscribers left. Finishing
  Sunday shows a "you win" screen.
- Controls: arrows/WASD steer (left/right) and speed (up faster, down brake),
  Space/Z/J throws a paper left, P/Esc pause, M mute, Enter start.
  Touch: on-screen buttons on narrow/touch screens.
- Screens: title (logo, "PRESS ENTER", high score from localStorage, wrapped in
  try/catch), day intro ("MONDAY"), ride, end-of-day summary (street map of
  subscriber houses: delivered / missed / cancelled), game over, win.
