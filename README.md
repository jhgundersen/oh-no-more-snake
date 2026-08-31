# Oh No! More Snake

Omasnake, in a browser. Levels with closing obstacle layouts, a snake eater
that hunts your tail, and a Party Mode that analyses the music it is playing
and paints the board with it.

Play it at **[oh-no-more-snake.com](https://oh-no-more-snake.com)**.

This is a port of [omasnake](https://github.com/jhgundersen/omasnake), the
standalone Qt 6 game for Omarchy — same rules, same numbers, same jokes, no
Qt. It is framework-free HTML, Canvas and JavaScript, deployed on Cloudflare
Workers alongside
[Oh No! More Agents](https://github.com/jhgundersen/oh-no-more-agents).

![Oh No! More Snake on level 4, approaching the Apple logo](screenshot.png)

## Play

```sh
npm install
npm run db:local  # once, to create the local charts database
npm run dev       # Wrangler prints the URL, normally http://localhost:8787
```

`npm run serve` is a dependency-free alternative that serves `public/` with
Python, but it has no Worker, so the charts will not answer. The game is ES
modules either way, so it needs to be served — opening `public/index.html` from
the filesystem will not work.

## Controls

- Arrow keys, `hjkl`, or `wasd` — steer
- Space — pause, resume, or restart
- `p` — toggle Party Mode
- `n` — switch to the next soundtrack
- `m` — switch between Levels and Endless
- `b` — switch between wrapping and solid borders
- `f` — cycle the food skin
- `r` — start a fresh run
- `t` — cycle the theme
- `v` — fullscreen
- `c` — charts
- `2` — two players; again to close the box, and while a duel is up, to leave it
- `g` — jump to the next boss level. Local development only.

Development also gets a **go to** box under the buttons and a `?level=` query
parameter, both taking a name (`3.2`), the same with a dash, or a plain level
number. None of it exists on the deployed game, and a run that used any of it
is never charted and never sets a best score.
- Escape — leave fullscreen, or pause

On a touchscreen, drag on the board to steer and tap it to cycle the food skin.

`?full` opens the page with the board covering the viewport and nothing else on
screen — for kiosks, second monitors and screenshots. It is the CSS half of
fullscreen rather than the Fullscreen API, which refuses any request that did
not come from a gesture and so can never be driven from a URL. `?full=0` is an
explicit no, so the parameter can be templated in as a variable.

## Two players

`2` opens a lobby. Everyone in it picks a name and a face, the first seat picks
the game, and a match starts when both players say they are ready — nobody is
dropped into a countdown they were not looking at.

There are two games.

**Race** — a board each, side by side, and a round is a *set* of levels. Round
one is 1.1 to 1.5, round two is 2.1 to 2.5, and the round is won by beating the
boss waiting at the end of it: the duel at the top of every set is the
finishing line, fought rather than merely arrived at. Crashing costs the set
rather than the round — you go back to its first level while the other lane
keeps going, which is the whole penalty and the whole tension. The two boards
never touch: no shared apple, no obstacles sent across, no interference of any
kind. On a narrow screen the boards stack instead of sitting side by side.

A lane is not a stripped-down snake game standing in for a run — it *is* a run.
Each one is a whole `Game`, so a race gets the levels, the layouts, the bosses,
the snake eater, the ball and Party Mode without a second implementation of any
of them.

**Party Mode, one player at a time.** Either player can turn it on for their own
board in the lobby, and a small party hat over that snake's head says which. It
brings everything it brings to a run: the combo multiplier, Food Frenzy,
Reverse Venom, Snake Byte, Corner Cutting and the rest. The disco ball still
works too — it only appears on a board without a party, and taking it starts
one for that player alone.

Beats are the exception. Only the browser playing the music can hear one, so
online it is reported to the room rather than measured there, which means Beat
Eater, Perfect Timing and Dance Floor are taken on trust. A reported beat can
only ever open a window on the lane of the seat that sent it, which is the most
it could be trusted with. Party Mode's other scoring needs no music at all.

**Duel** — one board, one apple, and a round is won by outliving the other.
Both snakes into the same cell nose first is nobody's round, unless one of them
had eaten more that round, in which case it is theirs. Every apple eaten speeds
the board up for both of them.

Either way the match runs to however many rounds the lobby was set to, and ends
on a podium: the winner up on the tallest box wearing a crown, everybody else
on a smaller one looking about as pleased as you would expect. The line across
the top is drawn from a pool, so it is rarely the same twice.

The two snakes are told apart by shape as well as colour: the first is square
and the second is round. Half the palettes make the accent and the foreground
two shades of the same blue, and two snakes a player cannot tell apart at a
glance is not a game.

Each seat also picks a face — wide, slit, visor, fierce, cyclops or sleepy.
They differ in the eyes and nothing else, because a horn or a crest is a bump
at the ten pixels a head actually is. Names and faces are remembered.

**Same keyboard.** One set of keys per seat: the arrows, `wasd`, `ijkl` and the
number pad (`8456`). The vi keys a run steers with are not among them, because
`jkl` belong to the third player here. No chat and no link, for obvious reasons.

**Online.** *Create a room* gives you a lobby with a link to send. Whoever
opens it takes the other seat; anyone after that watches and can still talk.
You take the seat the room gives you and with it that seat's name and face, and
the room remembers both, so a rematch does not mean picking again.

The room runs the game — it holds the board, decides who reached the apple, and
sends both browsers the same picture to draw, which is why neither of them can
disagree about it. A board step is 85–140 ms, comfortably longer than the trip
to the room, so nothing is predicted locally and nothing has to be rolled back.

Browser to browser was the other option and is not this one. WebRTC would still
need a signalling server to introduce the two peers, a TURN relay for the
connections that will not traverse a NAT, and a secure context that this page
is not allowed to assume — and with a shared board one of the two browsers
still ends up refereeing, which means one of the players can cheat and their
lag becomes the other's.

Nothing about two players reaches the charts or a best score. There is no score
to send: there are rounds.

## How it plays

Levels runs in sets of five: four boards and a duel, named 1.1 to 1.5, then 2.1
onwards. 1.1 is deliberately empty; after that there are twelve board shapes,
each drawn in four orientations, so nothing repeats for forty-eight levels —
and by then the gaps have closed and it does not look like the same board
anyway. Every set the tick gets 5 ms faster, down to a floor of 55 ms; every
second set a level costs one more apple; every third set the gaps close by a
cell. From level 4, a snake eater hunts the tail: each bite removes one
block and one point, and steering the head into it earns two points and drives
it away for a while. Endless is the classic open board at one speed.

Borders wrap until you press `b`, which is the one rule here that differs from
the desktop version — a page somebody just opened is usually their first game.
Moving into the cell your own tail is leaving is legal, because the tail leaves
it during the same tick. In Party Mode that is worth a point.

Best scores, lifetime playtime, border mode, food skin and theme are stored in
the browser's local storage. Levels and Endless keep separate bests.

## Party Mode

Press `p`, or eat the disco ball that appears while the music is off.

Party Mode analyses each song live through Web Audio — one-pole filters split
it into three bands, a rolling energy average finds onsets, and a bank of
Goertzel resonators produces 48 logarithmic bands. No BPM file or other
metadata is required. The obstacles light up by band, the snake wears the lead
line, and a beat sends a wave down its body.

Scoring changes with it. Food starts at one point; eating another within two
seconds raises the next one to two, then three, up to ten. The streak meter
counts down and expiry resets food to one point. Every point scored also grows
the snake by one block, appearing over the following ticks. Corner Cutting,
Thread the Needle, Snake Byte, Tailgate, Beat Eater, Perfect Timing and Dance
Floor reward tight driving and moving in time with the music. Each announces
itself on the board.

More events unlock as Levels progresses. Reverse Venom appears from level 6
and rotates your steering a quarter turn for five seconds. From level 8, Food Frenzy scatters
ten bonus foods for eight seconds. Timing and positions are randomised every
time.

With the music on, a cleared level waits for a beat before the next one fades
in — but not forever. A track too slow or too quiet to produce one gives up
after two and a half seconds, and after the first second any key or a tap
gets on with it.

## Your own music

Drop audio files anywhere on the page. They join the playlist, sorted by
filename, and `n` cycles through them. Boss tracks are not part of the
playlist and are never cycled into. This is the browser's answer to the
desktop version's `~/.local/share/omasnake/music`; object URLs do not survive a
reload, so dropped tracks last for the session.

## The ball

From set 3 a football and a goal appear on every board. Run your head into the
ball and it is kicked the way you were going — and then it keeps going. It does
not slow down and it does not stop: it rolls at your own pace, spinning as it
travels, turning round off walls, obstacles and your own body, and carries on.

The only way to aim it is to get in front of it. Your head is a boot rather
than a wall, so putting it in the ball's path sends the ball off the way *you*
were moving: come at a ball rolling east from below and it leaves heading
north. Working a loose ball round the board and into the net takes several of
these, which is the game of it.

Five points for a goal, and both the ball and the net leave the board. It is
never dangerous, whatever it hits, and a ball nobody scores with just keeps
rolling until the level ends.

## Boss fights

Levels come in sets of five, named for where they sit: 1.1 through 1.4 are
boards, 1.5 is a duel, then 2.1 begins again narrower, faster and worth more.
The rival turns up in an empty arena, announced by name and portrait the way
Party Mode announces itself.

Eat him. Every part of a boss is worth reaching: bite the tail and it gets
shorter, bite the middle and it comes apart, leaving a headless piece to drift
around the arena until you eat that too.

Reaching the head ends the fight on the spot — but only from the side or from
behind. Nose to nose neither of you gets anywhere: both snakes see stars, hold
still for a moment, and the boss backs off before returning to its senses.
Which it will be is written on its face, since a boss's red eyes point the way
it is looking, and it is chasing your tail — so where your tail is decides
which way it turns.

Being eaten is the only way to lose a duel. It hunts you as you hunt it, and it
notices company: get within a few cells of its head and it stops dawdling — the slower bosses give up the tick they
would have rested on, the quicker ones find an extra step — and its eyes glow
while it is paying attention. It takes blocks off your tail one at a time,
with no floor under it: eaten down to your last block is a loss. It will not
walk into the rest of you, so a duel can be taken slowly — the only thing that
kills you quickly is its mouth.

When only its head is left, everything stops for **FINISH HIM!** and five
seconds to press one of these:

| | |
|---|---|
| `↑ ↑ ↓ ↓` | Kernel Panic |
| `← → ← →` | Merge Conflict |
| `↓ ↓ ↑ ↑` | Garbage Collected |
| `← ← → →` | Stack Unwound |
| `↑ ↓ ← →` | Force Pushed |

Each one has its own animation, and each one ends with the boss's head coming
apart: shattered with the screen in Kernel Panic, blown back off the far wall
in Force Pushed, carried up the pipe in Garbage Collected. There is a
considerable amount of blood, which for a game about a snake eating an Apple
logo felt like the right call.

Only the last four inputs count, so a fumbled start costs nothing. Hesitating
past five seconds is a finish too — a worse one, and it still ends the same way. Winning pays for the level it
cleared, and whatever was scored during the fight is kept on top.

A duel has its own music. One of two boss tracks arrives at full volume with
the challenger card while whatever was playing falls away underneath it, and
when the level is over the playlist crossfades back in at the second it was
interrupted at. Pressing `n` during
a fight does not interrupt the boss track; it chooses what comes back.

The six bosses cycle: Null Pointer, Segfault, Deadlock, Stack Overflow, Race
Condition and Memory Leak. Their portraits are drawn rather than loaded, so
they cost nothing to download and sit correctly in every theme. You can tell
the two snakes apart at a glance without reading anything: yours has wide
friendly eyes, and a boss has narrow red ones under a scowl.

## Charts

Press `c`. The four boards are the highest scores of the last 24 hours, 7 days
and 30 days, and of all time — rolling windows, so no timezone has to be picked
and everybody reads them the same way.

There is nothing to type. A finished run is posted as a score, whether it was
Levels or Endless, whether Party Mode was on, and when it ended. No name, no
account, no cookie, nothing identifying. The level shown is derived from the
score by the server rather than accepted from the page.

Treat it as a community number rather than a leaderboard, but not a free-for-all.
A run asks the server for a signed token when it starts and hands it back with
the score, so both ends of the clock are the server's and the page never gets to
say how long its own run took. The score then has to be reachable in that time:
Endless is capped by the area of the board, because every point is a block the
snake grows by and nothing resets it; Levels has to account for the fade out and
back in that each level it claims would have cost. A token is spent when it is
used, so it buys exactly one entry. Submissions are also bounded, idempotent per
run, and rate-limited per minute against an address hashed with a Worker secret.

None of that makes a posted number true — the client is still the thing doing
the counting. It makes a made-up one cost the time it claims to have taken,
which for a game about a snake is the right amount of effort to demand.

## Credits

The four logo food skins are glyphs from [Nerd Fonts](https://github.com/ryanoasis/nerd-fonts)
(MIT), subset from its Symbols-Only font to just those four and served with the
page so they render without anything installed locally.

## Themes

Ten palettes in the Omarchy house style, dark and light. The first load follows
`prefers-color-scheme`; after that `t` cycles and the choice is remembered.
Nothing in the game hardcodes a dark-only surface.

## Development

Requires Node.js 20 or newer for the tests; the game itself has no
dependencies and no build step.

```sh
npm run check     # syntax checks and the model tests
npm test          # the model tests alone
```

`test/game.test.js` is a port of the Qt version's `tests/tst_omasnake.cpp`,
extended where the browser port introduced its own risks. `public/snake/Game.js`
holds the rules and imports nothing from the browser, which is what lets Node
run them.

`test/versus.test.js` and `test/race.test.js` cover the two-player models the
same way. `public/snake/Versus.js` and `public/snake/Race.js` import nothing
from the browser either, which is what lets the room in `src/room.js` run the
very rules the page draws rather than a second copy of them that drifts. Online
play needs the Worker, so test it with `npm run dev` rather than `npm run
serve`.

## Deployment

Production is <https://oh-no-more-snake.com>, with `www` served the same way.

```sh
npx wrangler login
npm run deploy
```

`wrangler.jsonc` deploys `public/` as static assets, attaches both custom
domains, and runs the Worker first for `/api/*` and the page itself — the
latter so an http visitor is sent to https, since a page served insecurely has
no `crypto.randomUUID` and half the web platform behaves differently. The
charts live in D1. Versus rooms are Durable Objects, one per room code, and
store nothing: a match lasts exactly as long as its two players are connected.

Setting it up from scratch needs the database and the hashing salt:

```sh
npx wrangler d1 create oh-no-more-snake     # put the id in wrangler.jsonc
npx wrangler secret put RATE_LIMIT_SALT     # any long random string
npx wrangler secret put RUN_TOKEN_SECRET    # another one, used to sign runs
npm run db:remote
npm run deploy
```

For `npm run dev`, put the same two names in a `.dev.vars` file. It is
gitignored, and the values there only ever sign local runs.

### `POST /api/runs`

```json
{ "token": "eyJuIjoi….Ux7…" }
```

Taken when a run starts. It carries a nonce and the server's clock, signed;
nothing in it is readable or writable by the page.

### `GET /api/scores`

```json
{
  "periods": {
    "day": [{ "rank": 1, "score": 57, "level": 5, "mode": "levels", "party": true, "at": "2026-08-25 09:12:00" }],
    "week": [], "month": [], "all": []
  },
  "runs": 1,
  "size": 10
}
```

### `POST /api/scores`

```json
{
  "eventId": "550e8400-e29b-41d4-a716-446655440000",
  "score": 57,
  "mode": "levels",
  "party": true,
  "token": "eyJuIjoi….Ux7…"
}
```

The response is the updated boards. Reusing an `eventId` is idempotent, which
is what makes the browser's retry queue safe; reusing a `token` stores nothing,
because a run token buys one entry. A score that could not have been reached in
the time the token has been open comes back `422` with the reason.

### `GET /api/room/{code}`

A WebSocket upgrade, and nothing else — any other method gets `426`. The code is
4 to 12 letters or digits and picks the room; the same code always reaches the
same one, which is the whole of the matchmaking. `?wrap=0` from the first
arrival sets the borders for the match.

The room sends `welcome` (which seat, or `null` for a spectator, and the mode),
`lobby` whenever anything about who is here changes, `chatlog` once on arrival
and `chat` per message, `left` when a player drops, and `state` every board
step — carrying the whole board, with each cell as a single number. A race does
not send its walls: a lane's layout is `obstacleCells` of its level, which both
ends work out from the one number.

A client sends `turn`, `nick`, `head`, `mode`, `ready`, `chat`, `rematch` and
`tolobby`, and nothing else is listened to. `mode` is refused from anyone but
the first seat, names and messages are stripped of control characters and
capped, and every message is counted against a per-second budget.

## License

MIT. The game design, mechanics and copy are derived from the MIT-licensed
omasnake, itself derived from the MIT-licensed omarchy-snake-plugin.
