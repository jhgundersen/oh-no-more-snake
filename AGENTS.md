# Repository Guide

## Project

Production is `https://oh-no-more-snake.com`.

Oh No! More Snake is a framework-free browser port of
[omasnake](https://github.com/jhgundersen/omasnake), the standalone Qt 6 Snake
game for Omarchy. Static game files live in `public/`; there is no Worker code,
no API and no build step. It follows the conventions of its sibling,
`oh-no-more-agents`.

The Qt source at `/home/jonh/jonh.no/omasnake` is the reference for behaviour.
When the two disagree about a rule, a number, or a joke, the Qt version is
right and this one has a bug — with the deliberate exceptions listed under
"Where the web version differs".

## Important files

- `public/snake/Game.js` — rules, board state, level progression, collisions,
  persistence and the between-level state machine. A direct port of
  `src/gamemodel.cpp`. It imports nothing from the browser, so Node can test it.
- `public/snake/Draw.js` — all Canvas rendering. A port of the Qt Quick scene in
  `src/Main.qml`.
- `public/snake/Audio.js` — Party Mode's analysis, a Web Audio port of
  `src/musiccontroller.cpp`, plus the playlist and transport.
- `public/snake/Palette.js` — the ten themes and the colour helpers. Stands in
  for `src/theme.cpp`, which reads Omarchy's `colors.toml`.
- `public/snake/Messages.js` — the level-clear, game-over and combo pools,
  copied verbatim from the QML.
- `public/snake/web.js` — input, timers, animation values, the HUD, and the
  render loop. The half of `Main.qml` that is not drawing.
- `public/index.html` — the page, the CSS, and the only DOM the game has.
  Everything inside `#stage` is the game; the title and the blurb outside it are
  the page around the game. That division is the whole of the fullscreen
  feature — the browser renders only the fullscreen element's subtree, so
  nothing has to hide them.
- `public/snake/Scores.js` — posting a finished run and reading the charts back,
  including the retry queue for runs that could not be posted.
- `src/worker.js` — the two `/api/scores` routes and D1 access.
- `src/scores.js` — validation, JSON responses, and the four SQL windows. It
  imports `levelForScore` from the game itself rather than keeping a second
  copy of the rule.
- `migrations/` — ordered production migrations; never rewrite one that may
  already have been applied.
- `test/game.test.js` — a port of `tests/tst_omasnake.cpp`, extended.
- `test/scores.test.js` — what the charts endpoint accepts and refuses.
- `public/_headers` — cache lifetimes for what Workers Assets serves.
- `wrangler.jsonc` — the Worker, its D1 binding, and the apex and `www` custom
  domains. `RATE_LIMIT_SALT` is a Worker secret and is never committed.

## Working conventions

- Keep the game dependency-free and runnable as plain browser JavaScript. There
  is no bundler and no transpiler, and adding one is a bigger decision than it
  looks: `public/` is the deployed artifact.
- Keep rules in `Game.js` and rendering-only behaviour in `Draw.js`. If a
  behaviour can be tested in Node, it belongs in `Game.js`.
- Port numbers, not impressions. Durations, easing curves, thresholds and
  smoothing constants are what the game feels like; when changing one, check it
  against the Qt source first.
- Match the existing humour. Keep the messages geeky, gently sarcastic, and
  free of elapsed-time references.
- Add or update a model test whenever a game rule changes.
- The charts carry no names, no accounts and nothing identifying, and must not
  start. A run is a score, a shape and a timestamp. Addresses are only ever
  seen as a salted hash for rate limiting.
- Never trust the page for anything the server can work out. The level on a
  board is derived from the score, not accepted from the client.

## Behaviour invariants

These come from the Qt version and hold here too.

- Preserve both Levels and Endless, their separate best scores, queued two-turn
  input, solid/wrapping borders, food skins, and lifetime playtime.
- Moving into the current tail cell is legal when that tail moves away during
  the same tick.
- Level transitions pause movement and clocks, fade out the completed layout,
  swap and respawn while invisible, then fade in the next layout beneath the
  level-clear overlay. With music on, the fade-in waits for a strong beat.
- Choose humorous level-clear and game-over messages once per event and avoid
  immediate repeats.
- Preserve keyboard access: arrows, `hjkl` and `wasd` steer; Space pauses or
  restarts; `m`, `b`, `f`, `r`, `p` and `n` keep their documented actions.
- The level-clear screen must always be escapable. It waits for a strong beat
  only while one might still arrive: `LEVEL_BEAT_WAIT_MS` ends the wait, and
  after `LEVEL_SKIP_AFTER_MS` any key or a tap ends it. A silent or slow track
  must never strand it.
- The board is sized from the room its frame has left over, never by adding up
  its siblings. Anything given `max-width: var(--board-w)` must not change
  height with width, or the measurement becomes circular — which is why the
  controls row spans the stage instead of the board.
- Never hardcode a dark-only surface. Every palette in `Palette.js` must stay
  readable, and the six theme names are the only colours the game may use.
- Buttons keep hover and active feedback and accessible names. Shortcut letters
  are shown by bolding the first letter, not with `(x)` text.

## Where the web version differs

Each of these is a deliberate answer to something a browser cannot do. Do not
"fix" one back to the desktop behaviour without replacing it with something.

- **Themes ship with the page.** There is no `colors.toml` to read and no
  desktop portal to ask about dark mode, so `Palette.js` carries ten palettes,
  the first load follows `prefers-color-scheme`, and `t` cycles.
- **The shortcut letter is bold only, not recoloured.** The Qt build paints it
  `foreground` on an `accent` button, which disappears on a light theme.
- **Nerd Font food glyphs are conditional.** The Apple, GitHub, OpenAI and
  Linux glyphs are private-use codepoints. They join the cycle only when
  `document.fonts.check` confirms the family is installed; otherwise the cycle
  is the five fruit, because the alternative is four identical boxes.
- **Custom music is dropped, not read from disk.** A page cannot see
  `~/.local/share/omasnake/music`. Dropped files last for the session, because
  object URLs do not survive a reload.
- **Playback needs a gesture.** `toggle()` must be reached from an event
  handler. `play()` starts the element before resuming the context and never
  awaits the resume — a context suspended by the autoplay policy stays
  suspended, and awaiting it hangs instead of reporting a refusal.
- **Analysis runs on a clock, not per buffer.** There is no
  `QAudioBufferOutput`. `music.update()` is called every animation frame but
  analyses at roughly one buffer's cadence, because the smoothing constants
  were tuned per buffer.
- **The rhythm timer is gone.** `MusicController::beat` had no listener in the
  QML, so it was not ported.
- **Borders wrap by default.** The desktop version starts solid. A page is
  usually somebody's first game, and a first game that ends in three seconds
  against a wall is a worse introduction than one that does not. A stored
  `false` is still a decision and outlives the default; only its absence wraps.
- **Escape leaves fullscreen, or pauses.** There is no window to close. Real
  fullscreen is the browser's to exit; the CSS stand-in has to be told.
- **Fullscreen is `v`, labelled "View".** Bolding the first letter of
  "Fullscreen" would claim `f`, which has cycled the food skin since the
  desktop version. `?full` turns on the CSS half at load, for kiosks and
  screenshots; the Fullscreen API cannot be reached from a URL.
- **The splash canvas lives inside `#stage`.** A sibling would not be drawn in
  fullscreen, where only the fullscreen element's subtree renders.
- **A hidden tab pauses the game** and saves. Nobody is playing a tab they
  cannot see.
- **Only the board is Canvas.** Scores, meters and buttons are DOM, so they
  keep their text and accessible names; board state changes are announced
  through the `#status` live region.

## Validation

Run before committing:

```sh
npm run check
```

That is `node --check` over every module and the model tests. For visual
behaviour, serve it and play it:

```sh
npm run serve
```

Check at least one dark and one light theme, and check Party Mode with the
music actually playing — the analysis is most of what Party Mode is, and it
cannot be tested from Node.

## Release workflow

Commit focused changes to `main` and push `origin/main`. Do not commit
`node_modules/`, `.wrangler/`, or scores and other local state. Soundtracks are
cached forever by `public/_headers`: a replacement track gets a new number, it
never overwrites an existing file.
