# Repository Guide

## Project

Production is `https://oh-no-more-snake.com`.

Oh No! More Snake is a framework-free browser port of
[omasnake](https://github.com/jhgundersen/omasnake), the standalone Qt 6 Snake
game for Omarchy. Static game files live in `public/` and there is no build
step; the Worker in `src/` exists only for the charts and for versus rooms. It
follows the conventions of its sibling, `oh-no-more-agents`.

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
- `public/snake/Versus.js` — the two-player model: two snakes, a shared apple,
  rounds, and the snapshot that travels between a room and a browser. It is not
  a mode inside `Game.js` and must not become one. Like `Game.js` it imports
  nothing from the browser, which is what lets both Node and the Worker run it.
- `public/snake/Race.js` — the racing model: a board each, the single-player
  game's own levels, and the first to level 5 takes the round. It presents the
  same handful of methods `Versus.js` does, which is what lets the room and the
  browser drive either without knowing which they have.
- `public/snake/Net.js` — the browser's end of a room: the socket, the room
  codes, and nothing that decides anything about a match.
- `src/room.js` — the `VersusRoom` Durable Object. One per room code, holding
  the lobby, the chat, the board and the clock. It is written against the
  interface both models share and names neither of them except to build one.
- `public/snake/Scores.js` — posting a finished run and reading the charts back,
  including the retry queue for runs that could not be posted.
- `src/worker.js` — the `/api/scores` and `/api/runs` routes, D1 access, and
  the `/api/room/` upgrade. It also re-exports `VersusRoom`, because a Durable
  Object class has to be reachable from the Worker's entry module.
- `src/scores.js` — validation, JSON responses, the four SQL windows, and the
  plausibility rules. It imports the game's own constants rather than keeping a
  second copy of them, which is what keeps the bounds honest when a rule changes.
- `src/runtoken.js` — signing and reading the run tokens that give the server
  both ends of a run's clock.
- `migrations/` — ordered production migrations; never rewrite one that may
  already have been applied.
- `test/game.test.js` — a port of `tests/tst_omasnake.cpp`, extended.
- `test/versus.test.js` — the duel's rules: spawning, dying, and who takes a
  round when both of them die of it at once.
- `test/race.test.js` — the race's rules: climbing the levels, and what a crash
  costs.
- `test/scores.test.js` — what the charts endpoint accepts and refuses.
- `public/_headers` — cache lifetimes for what Workers Assets serves.
- `wrangler.jsonc` — the Worker, its D1 binding, the `ROOMS` Durable Object
  binding, and the apex and `www` custom domains. `RATE_LIMIT_SALT` is a Worker
  secret and is never committed.

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
- The versus board is six rows taller than the single-player one, so the cell
  floor that keeps a run readable is what pushes a duel out through the
  controls on a short window. A small board beats a board with a button across
  it, which is why the floor is lower while one is up.
- The board is sized from the room its frame has left over, never by adding up
  its siblings. Anything given `max-width: var(--board-w)` must not change
  height with width, or the measurement becomes circular — which is why the
  controls row spans the stage instead of the board.
- Never hardcode a dark-only surface. Every palette in `Palette.js` must stay
  readable, and the six theme names are the only colours the game may use.
- Buttons keep hover and active feedback and accessible names. Shortcut letters
  are shown by bolding the first letter, not with `(x)` text. Multiplayer is
  the one button with nothing bolded: its shortcut is `2`, `m` belongs to Mode,
  and of the word's own letters only `u`, `y` and `e` are free — none of them
  the first. "2 Multiplayer" reads like a typo rather than like a shortcut, so
  the button says the word and the key is documented instead.

## Multiplayer invariants

Multiplayer is new here — the Qt version has no multiplayer at all — so these
come from nowhere but this repository. There are two games: a duel on one board
and a race on two. Both present the same interface (`phase`, `players`,
`advance`, `tick`, `turn`, `setHead`, `startMatch`, `snapshot`,
`applySnapshot`, `tickInterval`), and `src/room.js` and the two-player section
of `web.js` are written against that and not against either model. Adding a
third mode should mean adding a model, not editing those two.

- **Each game is its own model.** Neither `Versus.js` nor `Race.js` is a mode
  inside `Game.js` and neither must be folded into one. Everything they want,
  the level machinery would have to be taught to ignore; everything the level
  machinery does, they do not want. Small models beat one that is pretending.
- **A race lane is a whole `Game`, not something that resembles one.** That is
  the entire design of `Race.js`. Everything a race wants — levels, layouts,
  bosses, the snake eater, the ball, Party Mode and its combos — is already in
  `Game.js`, tested and ported, and a second implementation of any of it would
  be a second set of rules to keep in step with the first. A lane does not
  imitate a single-player run: it is one.
- **A round is a set, and its last level is a boss fight.** Round one is 1.1 to
  1.5, round two is 2.1 to 2.5. The round is won by beating the boss, not by
  arriving at it — `setStartLevel` and `setBossLevel` are the only places that
  arithmetic lives.
- **`Game.snapshot()` exists for the race and nothing else.** The desktop
  version never needs it: there is one board and it is in the process drawing
  it. Every getter `Draw.js` reads is derived from a field it carries, so
  restoring the fields restores the lot — a new field that the renderer reads
  has to be added to it.
- **The lanes of a race never touch.** No shared apple, no obstacles sent
  across, no interference. The pressure is the number on the other side of the
  screen going up, and that is deliberate: it was asked for as a pure race.
- **A crash in a race costs the set, not the round.** The lane sits still long
  enough to be looked at, then goes back to the first level of the current set
  while the other one keeps going. A lane whose game is over is a crash however
  it got there — checking only after a tick misses being eaten by a boss, which
  happens on the boss's clock rather than the snake's.
- **A lane's board has to move to the beat.** The single-player game animates
  the flash, the food throb and the wave down the snake with tweens fired by
  the analysis, which a lane cannot use: there may be four boards and only one
  of them is being listened to. What every lane does have is `beatWindowMs`,
  opened by its own player's music and sent on by the room — so a window that
  has just opened is a beat that has just landed, wherever it landed. A lane
  given a dead `danceWave` and static pulses draws a board in a party that is
  not moving, which is what shipped first.
- **How a board looks and sounds is the browser's, whoever is stepping it.**
  The beat, the bursts and the boss music all read state the room has already
  sent, so none of them may sit behind the early return that skips stepping a
  board this browser does not own.
- **There is one chat, and it moves.** It lives in the lobby and beside the
  board during a match, by being reparented rather than duplicated — two of
  them is two logs that disagree. The board is measured around the panel and
  centred in what is left, so opening it never covers the board it made room
  for; where there is no width for that, it goes underneath instead.
- **The podium is the end of a match.** Ranked on wins, then on whatever the
  mode counts, then on seat so two players who did equally well are still put
  in a fixed order. The winner smiles and the rest do not, which is a mouth
  drawn over the face they chose rather than a face of its own — losing should
  not cost somebody the head they picked. Its line is chosen once when the
  match ends, not per frame, or the joke changes while it is being read.
- **Party Mode starts the music.** It has meant music since the desktop
  version, and a party with nothing playing is most of the point missing. The
  click that asks for it is also the gesture playback needs, which is the one
  moment it can be started from. A combo nobody can see is a combo nobody plays
  for: a run shows it in the meters, and a race shows it in the lane's caption,
  because the meters belong to one board and there may be four.
- **Party Mode is how a race is played, not a choice about it.** Every lane has
  it, which is why there is no hat and no toggle: both only ever answered a
  question nobody is being asked. Beats are the one part that cannot be
  measured server-side — only the browser playing the music hears them — so
  they are reported, and a reported beat may only ever open a window on the
  lane of the seat that sent it. Nothing else about Party Mode needs a beat.
- **The disco ball stays on a race board, and goes when it is taken.**
  `setPartyMode` would ordinarily take it away, the party having started; here
  it is put back, because it is the offer of the music rather than of the
  party, and the music is the one part a room cannot switch on for anybody.
  `Game.tick` clears it on being eaten rather than leaving that to whatever
  happens next — in a run that was always Party Mode switching it off a moment
  later, which a race has already done, so the same ball could be eaten over
  and over.
- **Both models are driven by one `step(ms)` and one `pace`.** The room and the
  browser call those and nothing else, which is what lets a race run its two
  lanes on two different clocks — a lane on 2.3 moves quicker than one on 2.1 —
  without either driver knowing.
- **The lobby is built once and updated in place.** Nothing in `renderLobby`
  may replace, hide or disable a node somebody might be typing into. Rebuilding
  it per message is what it did first, and since every keystroke in a name
  field sends a message that comes back as a lobby, the field being typed in
  was replaced after every letter and the caret thrown out with it. The name is
  also kept locally at once and told to the room only once the typing stops.
- **A duel has one ending: a wall on the board.** Running into a rival — or
  into yourself — is a bite and never a death: what is behind it comes off as
  scraps anybody can eat, and a snake bitten down to a bare head keeps playing
  and can eat its way back. A bite that killed was tried and taken out again,
  because it had to be explained, and a rule that has to be explained does not
  belong on a board. Bites are resolved after everybody has moved, so one is
  decided against where the bodies ended up rather than where they set off
  from, and two mouthfuls out of one snake on one tick take the worse of them.
- **Nose to nose is stars, not an ending.** Both stay where they are and both
  see them, exactly as a snake and a boss do. Steering is allowed while they
  last and the queued turn is taken the moment they clear, which is the only
  way out of one — and a snake seeing stars is still on the board to be bitten,
  which is what makes a headbutt worth landing.
- **Multiplayer always wraps.** There is no borders option on either model and
  no `?wrap=` on a room. An edge that kills you is a third party with an
  opinion, and a duel is decided by what the players do to each other. The
  Borders button belongs to a run and is locked while a match is on rather than
  left saying something untrue of the board on screen.
- **The playlist is synced, and only the playlist.** Which song, not where it
  is up to: a position would be a clock problem for no gain. A track is only
  applied from a playlist the same length as this one, because somebody who
  dropped their own music is on a different list and the same number is a
  different song there.
- **A lobby is not a doorway.** A match starts when both seats are filled *and*
  both players have said they are ready. Changing the mode clears readiness,
  because changing the game is a reason to look again before starting it.
- **The room decides, never a browser.** Both clients render what the room
  sends and send only the direction they would like to go. A browser that gets
  to say who reached the apple is a browser that can say it reached the apple,
  and its lag becomes the other player's lag. Nothing about a match may be
  predicted locally: at 70–140 ms a step there is nothing to hide.
- **Both spawns are the same spawn turned through half a turn**, and so is
  every obstacle arrangement. Any layout that is not symmetric under a half
  turn hands one of the two players the better side of the board. The spawn
  runway is kept clear of walls for the same reason `findSpawn` exists in the
  single-player game.
- **Four is the ceiling, and it is not arbitrary.** Snakes are told apart by
  shape against colour, and the board may only use the theme's accent and
  foreground: two shapes against two colours is exactly four. `MAX_SEATS` is
  that arithmetic and not a preference. A fifth seat needs a new answer to the
  identity problem before it needs any code.
- **Seats keep their numbers.** A model always has four player slots and
  `present` says which are occupied, so seat two is seat two to the room, the
  board, the keyboard and the person sitting in it. Compacting the occupied
  seats down would renumber people whenever somebody left.
- **Four is the ceiling, and it is not arbitrary.** Snakes are told apart by
  shape against colour, and the board may only use the theme's accent and
  foreground: two shapes against two colours is exactly four. `MAX_SEATS` is
  that arithmetic and not a preference. A fifth seat needs a new answer to the
  identity problem before it needs any code.
- **Seats keep their numbers.** A model always has four player slots and
  `present` says which are occupied, so seat two is seat two to the room, the
  board, the keyboard and the person sitting in it. Compacting the occupied
  seats down would renumber people whenever somebody left.
- **Colour alone cannot tell the snakes apart.** In half the palettes the
  accent and the foreground are two shades of the same blue, so the second
  snake is drawn round where the first is square. That difference has to
  survive, whatever else changes: a duel between two snakes a player cannot
  distinguish is not a duel. The numbered tags are a supplement, not the
  answer — they only appear when the board is still.
- **A face is picked before a round and never during one.** `setHead` refuses
  while the board is moving; a snake changing expression mid-round is a thing
  to look at during the one moment there is something else to look at. The
  roster lives in `Versus.js` because a head travels on the wire and a room has
  to be able to refuse one it does not recognise — how each is painted is
  `Draw.js`'s business, exactly as a boss's roster and its portrait are kept
  apart. Every head differs in the eyes alone: a horn or a crest is a bump at
  the ten pixels a head actually is.
- **A face is clipped to the head it is on.** A brow drawn to the corner of the
  block it was given lands outside a round head and reads as whiskers.
- **A duel round is a minute, and the longest snake takes it.** With only one
  way to lose, a round without a clock is two careful players circling each
  other indefinitely — so the clock is what ends most of them, not a backstop.
  Length decides it, then apples, then nobody, and running out kills no one.
  The last five seconds are marked on the board: a round that simply stops is a
  round nobody was racing.
- **Rounds have to end.** In a duel, apples speed the board up for both players
  and every round starts quicker; in a race the pace follows whichever lane is
  further ahead. `STALEMATE_TICKS` is the backstop in both, for two players who
  never eat, and without it an online room could stay open for ever.
- **A frame carries what changed and nothing else.** `Game.snapshot` leaves out
  every field still at the value a fresh board gives it, and `BOARD_FIELDS` is
  the single table both halves read so they cannot drift apart. Cells go as one
  number each. A board that has not changed is not sent at all, which is what
  makes a countdown or a round-over screen free. Four boards for four people
  went from about 320 KB a second to about 30 by doing those three things and
  nothing cleverer — a delta encoding would be the next step and is not worth
  its resync problems yet.
- **A number that changes every step defeats that.** The duel's clock is sent
  to the quarter second for exactly that reason: it is read in whole seconds,
  and at full precision every board looks new and nothing is ever skipped.
- **Nothing off the wire is trusted, and nothing typed is ever markup.** Names
  and chat are stripped of control characters and capped by the room, and put
  on screen with `textContent` and never `innerHTML`. Both halves stay: the
  room is what stops a newline reaching a nickname, and the browser is what
  stops a tag reaching the page.
- **The mode belongs to the first seat.** Somebody has to be the one deciding,
  and a room where either player can change the game from under the other is a
  room where neither can get ready.
- **Nothing a duel does may reach the charts or a best score.** It has no score
  to send; it has rounds. Entering one pauses the single-player run rather than
  ending it, and the run's token keeps running — which is the same thing any
  other pause does.
- **A room that is doing nothing shuts itself.** The sockets are accepted
  rather than hibernated, because a hibernated object has no clock to run a
  board on — which means an open socket keeps the object resident and billed
  for as long as it is there. So a room that is not playing and has heard
  nothing for a quarter of an hour closes, and says why. A match in progress is
  never interrupted, and anything anybody says or does resets the clock.
  Hibernating while in the lobby would be the next step and is the only way to
  make a waiting room genuinely free.
- **Space goes back to the lobby, not into the same match again.** After a
  match people want a different face or a different game far more often than
  they want a repeat, and the lobby is where both of those live. There is no
  rematch message.
- **A room stores nothing.** A match is worth exactly as long as its two
  players are connected. The Durable Object holds it in memory on purpose, and
  the sockets are accepted rather than hibernated because a hibernated object
  has no clock to run a board on.
- **Nothing on the wire may be trusted.** A client sends a direction and a
  rematch and nothing else is listened to; messages are capped by size and by
  rate, and a seat can only ever steer its own snake.

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
