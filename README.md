# Oh No! More Snake

Omasnake, in a browser. Levels with closing obstacle layouts, a snake eater
that hunts your tail, and a Party Mode that analyses the music it is playing
and paints the board with it.

This is a port of [omasnake](https://github.com/jhgundersen/omasnake), the
standalone Qt 6 game for Omarchy — same rules, same numbers, same jokes, no
Qt. It is framework-free HTML, Canvas and JavaScript, deployed on Cloudflare
Workers alongside
[Oh No! More Agents](https://github.com/jhgundersen/oh-no-more-agents).

![Oh No! More Snake on level 4, approaching the Apple logo](screenshot.png)

## Play

```sh
npm run serve     # http://localhost:8787, no dependencies
```

or, with Wrangler installed, `npm run dev`. The game is ES modules, so it needs
to be served — opening `public/index.html` from the filesystem will not work.

## Controls

- Arrow keys, `hjkl`, or `wasd` — steer
- Space — pause, resume, or restart
- `p` — toggle Party Mode
- `n` — switch to the next soundtrack
- `m` — switch between Levels and Endless
- `b` — switch between solid and wrapping borders
- `f` — cycle the food skin
- `r` — start a fresh run
- `t` — cycle the theme
- Escape — pause

On a touchscreen, drag on the board to steer and tap it to cycle the food skin.

## How it plays

Levels introduces one of eight repeating obstacle layouts after level 1 and
gradually increases the speed. Every eighth level the gaps narrow by one cell,
the level costs one more apple, and the tick gets 7 ms faster, down to a floor
of 55 ms. From level 4, a snake eater hunts the tail: each bite removes one
block and one point, and steering the head into it earns two points and drives
it away for a while. Endless is the classic open board at one speed.

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

More events unlock as Levels progresses. Beat Gates appear from level 6 and
open only on strong beats, starting with one gate and adding another every
three levels up to four. Reverse Venom appears from level 6 and rotates your
steering a quarter turn for five seconds. From level 8, Food Frenzy scatters
ten bonus foods for eight seconds. Timing and positions are randomised every
time.

With the music on, a cleared level waits for a beat before the next one fades
in.

## Your own music

Drop audio files anywhere on the page. They join the playlist, sorted by
filename, and `n` cycles through them. This is the browser's answer to the
desktop version's `~/.local/share/omasnake/music`; object URLs do not survive a
reload, so dropped tracks last for the session.

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

## Deployment

```sh
npx wrangler login
npm run deploy
```

There is no Worker code and no API — `wrangler.jsonc` deploys `public/` as
static assets. Add a `main` if a scoreboard ever needs a server side.

## License

MIT. The game design, mechanics and copy are derived from the MIT-licensed
omasnake, itself derived from the MIT-licensed omarchy-snake-plugin.
