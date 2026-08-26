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
- `public/snake/boss_1.mp3`, `boss_2.mp3` — the duel soundtrack. Like the rest
  of the audio these are cached forever, so a replacement gets a new number.
- `public/snake/Bosses.js` — the boss roster, their drawn portraits, and the
  finisher combinations. Portraits are canvas shapes rather than image files:
  six pictures would be most of the page's weight, and drawn ones sit correctly
  in every theme.
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
- `src/scores.js` — validation, JSON responses, the four SQL windows, and the
  plausibility rules. It imports the game's own constants rather than keeping a
  second copy of them, which is what keeps the bounds honest when a rule changes.
- `src/runtoken.js` — signing and reading the run tokens that give the server
  both ends of a run's clock.
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
- Nothing in the page may assume a secure context. Over plain http there is no
  `crypto.randomUUID` and no `crypto.subtle`, and reaching for one throws where
  the score is posted — which is exactly how score submission broke. Event ids
  fall back to `getRandomValues`, and posting a score can never throw its way
  out of a game over.
- The http-to-https redirect keys off `cf-visitor` and nothing else. `wrangler
  dev` rewrites the request URL to the production route, so a local session
  looks identical to an insecure production one; guarding on the URL's host or
  scheme redirected localhost to itself, forever.
- Never trust the page for anything the server can work out. The level on a
  board is derived from the score, and how long a run took is measured by the
  server's clock at both ends — neither is accepted from the client.
- A plausibility bound must never reject a real run. They are deliberately
  several times looser than human play: a refused honest score is a worse bug
  than an accepted dishonest one. When a game rule changes, check the bounds in
  `src/scores.js` still hold — especially `ENDLESS_CEILING`, which is only true
  while every point grows the snake and Endless never resets the board.

## Behaviour invariants

These come from the Qt version and hold here too.

- Preserve both Levels and Endless, their separate best scores, queued two-turn
  input, solid/wrapping borders, food skins, and lifetime playtime.
- The ball is never lethal and must stay that way — it is a toy on the board,
  not a hazard. It moves at the snake's own pace: quicker than that and there
  is no time to read it, and pushing it from behind cannot steer it anyway,
  because turning breaks contact. It steps one cell at a time, so raising
  `BALL_SPEED` again could never let it jump a wall.
- Nudging a ball along the line it is already on is not a kick. It neither
  sparks nor counts as one, or chasing a ball would strobe every tick.
- A kicked ball never stops. Friction would make it a one-shot puzzle; rolling
  for ever makes it a moving one, which is the point. Everything it meets turns
  it round *except* the snake's head, which strikes it: the head is a boot and
  the body is a wall, and that distinction is the only way to aim a ball that
  is already moving.
- Party Mode may not kill. Its events add scoring, steering and clutter; Beat
  Gates were removed because they appeared under a moving snake and ended runs
  that had done nothing wrong. `beatWindowMs` stays — Beat Eater, Perfect
  Timing and Dance Floor all read it — but nothing it opens may be lethal.
- Levels come in sets of five, named `set.position`: 1.1 to 1.4 are boards and
  1.5 is a duel. `layoutOrdinal` counts past the bosses and past 1.1, which is
  empty on purpose. Difficulty rides on `difficultyOf` — the set number, and
  nothing else — while the board shape rides on the layout ordinal, so variety
  and difficulty can be tuned without disturbing each other.
- A layout must always leave the snake somewhere to spawn. `findSpawn` falls
  back to a fixed cell, which on a crowded board means spawning inside a wall;
  the spawn test is what catches a new shape that does that.
- A boss level is cleared by winning, not by scoring, so `level` is pinned to
  `displayedLevel` for the duration. Without that a lucky run of apples during
  a duel starts the next level on top of the boss.
- A duel is lost by being eaten and by nothing else. Running into the boss
  nose first used to end the run; it now stuns both of them, cancels the move
  and sends the boss backing off. Anything that makes a headbutt fatal again
  is a regression.
- A boss's body never kills by being touched: it splits when bitten, and what
  comes off drifts as a headless husk that can also be eaten. Only its mouth
  is lethal. Reaching the head from the side or behind wins outright; reaching
  it head-on loses. That one rule is what makes a duel losable at all — without
  it a snake can walk straight at the head and take it every time, which it
  could, four hundred times out of four hundred.
- The rule has to stay legible or it is just an unfair death. A boss's red eyes
  face the way it is looking, the arena says "never head-on", and losing to the
  jaws says so by name instead of drawing from the usual message pool.
- A boss keeps hunting the tail even when the snake is at its neck; being
  alert only makes it move more. Making it turn to face the threat instead
  sounds better and plays worse: it cannot turn towards something it is
  already beside, because the cell it would step into is that thing, so it
  sidles along with its head pointed elsewhere — which makes every approach a
  safe one and quietly deletes the only way to lose a duel.
- `moveBoss` eats from the tail and only the tail. It must not step onto the
  snake's head: the boss moves after the snake does, so going in to bite its
  head would be fatal by construction. Being eaten down to the last block is
  the loss, and that block is the head.
- Eyes are how the two snakes are told apart, not colour: wide and friendly on
  the snake, narrow and red under a brow on a boss. They face the direction of
  travel, which is also what makes the head readable at a glance.
- Every way of skipping levels — the `g` key, the **go to** strip, `?level=`
  and `omasnake.jumpTo` — hangs off the single `debugKeys` gate and must keep
  doing so. Reaching a level without playing to it is also reaching a score
  without playing for it, which is why `jumpToLevel` marks the run as practice
  as well. Two locks, deliberately.
- Nothing a run did not earn may reach a best score or the charts.
  `jumpToLevel` sets `practiceRun`, and both `finish()` and the chart
  submission check it.
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
- **The four logo food skins ship with the page.** Apple, GitHub, Docker and
  Linux are private-use codepoints that almost nobody has installed, so
  `public/snake/symbols.woff2` carries them: the MIT-licensed Nerd Fonts
  *Symbols Only* font subset to exactly four glyphs, 2.5 MB down to 1.8 kB.
  Regenerate with `pyftsubset SymbolsNerdFont-Regular.ttf
  --unicodes=U+F0035,U+F02A4,U+F0868,U+F17C --flavor=woff2 --layout-features=''
  --no-hinting --desubroutinize --name-IDs=''`. A fifth logo means a new subset
  and a new `unicode-range` on the `@font-face`, which is deliberately narrow so
  the font is only ever fetched for these codepoints.
- U+F0868 is `md-docker`, whatever the desktop version's comment says. It draws
  a whale and always has; the name was wrong, not the glyph.
- Canvas will draw a glyph whose font has not arrived yet, as a blank. The page
  waits for the symbol font before its first paint for exactly that reason.
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
