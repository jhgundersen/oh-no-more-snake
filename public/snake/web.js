// Browser wiring: input, timers, animation values, the HUD and the render loop.
//
// This is the QML file's other half — everything `src/Main.qml` does that is
// not drawing. The animation constants, easing curves and the order effects
// fire in are all from there, because they are what the game feels like.

import { COLUMNS, ROWS, Game, bossNumber, levelFromName, levelName, nextBossLevel } from "./Game.js"
import { MusicController } from "./Audio.js"
import {
  draw,
  drawBossSplash,
  drawHeadPreview,
  drawRace,
  drawSplash,
  drawVersus,
  boardSize,
  laneEffects,
  laneMusic,
  raceFit,
  raceLayout
} from "./Draw.js"
import { Net, newRoomCode, roomLink, validCode } from "./Net.js"
import {
  HEADS,
  MAX_SEATS,
  MIN_SEATS,
  PHASE_MATCH_OVER,
  PHASE_PLAYING,
  Versus,
  DEFAULT_HEADS,
  validHead
} from "./Versus.js"
import { RACE_COLUMNS, RACE_ROWS, Race, setBossLevel } from "./Race.js"
import { FATALITIES, bossFor } from "./Bosses.js"
import { gameOverMessages, levelMessages, partyComboName, pickDifferent } from "./Messages.js"
import { Charts, PERIOD_LABELS, describeRun, relativeTime } from "./Scores.js"
import { darker, mixColors, nextTheme, preferredTheme, resolve, rgba, themes } from "./Palette.js"

// --- storage -----------------------------------------------------------------

const store = (() => {
  try {
    localStorage.setItem("omasnake/probe", "1")
    localStorage.removeItem("omasnake/probe")
    return localStorage
  } catch {
    const memory = new Map()
    return {
      getItem: key => (memory.has(key) ? memory.get(key) : null),
      setItem: (key, value) => memory.set(key, String(value)),
      removeItem: key => memory.delete(key)
    }
  }
})()

// --- easing and tweens -------------------------------------------------------

const easing = {
  linear: t => t,
  outCubic: t => 1 - Math.pow(1 - t, 3),
  inCubic: t => t * t * t,
  inOutSine: t => -(Math.cos(Math.PI * t) - 1) / 2,
  inOutCubic: t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
}

// A QML NumberAnimation: restartable, stoppable, and reporting when it ends.
class Tween {
  constructor({ from, to, duration, curve = easing.linear, apply, onDone = null }) {
    Object.assign(this, { from, to, duration, curve, apply, onDone })
    this.running = false
    this.started = 0
  }

  restart(overrides = {}) {
    Object.assign(this, overrides)
    this.running = true
    this.started = performance.now()
    this.apply(this.from)
    return this
  }

  stop() {
    this.running = false
    return this
  }

  update(now) {
    if (!this.running) return
    const t = this.duration <= 0 ? 1 : Math.min(1, (now - this.started) / this.duration)
    this.apply(this.from + (this.to - this.from) * this.curve(t))
    if (t < 1) return
    this.running = false
    this.onDone?.()
  }
}

// --- effect state ------------------------------------------------------------

const fx = {
  boardContentOpacity: 1,
  foodPulse: 0,
  discoPulse: 0,
  backgroundPulse: 0,
  partySplashOpacity: 0,
  partySplashScale: 0.78,
  splashKind: "party",
  foodBurst: 1,
  burstX: 0,
  burstY: 0,
  scoreBurst: 1,
  scoreBurstText: "",
  nearMissBurst: 1,
  nearMissX: 0,
  nearMissY: 0,
  nearMissKind: "tailgate",
  partyBonusText: "",
  enemyBurst: 1,
  enemyBurstText: "",
  enemyBurstX: 0,
  enemyBurstY: 0,
  danceSide: 1,
  danceHistory: [],

  // Each beat sends a wave down the body; a segment feels it 32 ms after the
  // one in front of it, and the wave lasts 300 ms.
  danceWave(index) {
    const now = Date.now()
    const delay = index * 32
    let value = 0
    for (const wave of this.danceHistory) {
      const age = now - wave.time - delay
      if (age >= 0 && age <= 300) {
        const envelope = Math.sin((Math.PI * age) / 300)
        value += wave.side * wave.strength * envelope * Math.sin((Math.PI * 2 * age) / 300)
      }
    }
    return Math.max(-1, Math.min(1, value))
  },

  recordDanceBeat(strength) {
    this.danceSide = -this.danceSide
    this.danceHistory.push({ time: Date.now(), side: this.danceSide, strength: 0.72 + strength * 0.28 })
    while (this.danceHistory.length > 10) this.danceHistory.shift()
  }
}

// --- game, music, theme ------------------------------------------------------

const game = new Game({ store })
const music = new MusicController({ store })

let theme = resolve(preferredTheme(store.getItem("omasnake/appearance/theme")))
let levelMessage = ""
let gameOverMessage = ""
let gameOverMessageChosen = false
let waitingForLevelBeat = false
// Set when a run ends for a reason worth naming, in place of the usual pool.
let pendingGameOverMessage = null
let levelTransitionStarted = 0
let beatWaitStarted = 0

// A slow track — or a quiet passage in a loud one — can leave the level-clear
// screen waiting for a strong beat that is not coming. Two escapes: the wait
// gives up on its own, and after a second anybody can press their way out.
const LEVEL_BEAT_WAIT_MS = 2500
const LEVEL_SKIP_AFTER_MS = 1000

// Fruit plus the original plugin's four Nerd Font logos: Apple, GitHub, Docker
// and Linux. The desktop version calls the third one OpenAI, but U+F0868 has
// always been `md-docker` and a Docker whale is what it draws — the name was
// wrong, not the glyph, so the glyph stays.
//
// All four are private-use codepoints that used to need the font installed
// locally, so most players never saw them. The page now carries them itself.
const SYMBOL_FAMILY = '"Snake Symbols", "JetBrainsMono Nerd Font", monospace'
const foods = [
  { glyph: "🍎", family: "sans-serif" },
  { glyph: "🍇", family: "sans-serif" },
  { glyph: "🍓", family: "sans-serif" },
  { glyph: "🍒", family: "sans-serif" },
  { glyph: "🍉", family: "sans-serif" },
  { glyph: "\u{f0035}", family: SYMBOL_FAMILY },
  { glyph: "\u{f02a4}", family: SYMBOL_FAMILY },
  { glyph: "\u{f0868}", family: SYMBOL_FAMILY },
  { glyph: "\u{f17c}", family: SYMBOL_FAMILY }
]

// The board is canvas, and canvas will happily draw a glyph before its font
// has arrived — as a blank. Waiting for it is one line and saves a mystery.
async function loadSymbols() {
  try {
    await document.fonts.load(`16px ${SYMBOL_FAMILY}`, "\u{f0035}")
    await document.fonts.ready
  } catch {
    // Without it the four fall back to whatever the system has, as before.
  }
}

// --- elements ----------------------------------------------------------------

const el = id => document.getElementById(id)
const canvas = el("board")
const ctx = canvas.getContext("2d")
const splashCanvas = el("splash")
const splashCtx = splashCanvas.getContext("2d")
const status = el("status")

// --- animations --------------------------------------------------------------

const tweens = []
const register = tween => {
  tweens.push(tween)
  return tween
}

const foodBeatIn = register(new Tween({
  from: 0, to: 1, duration: 55, curve: easing.outCubic,
  apply: v => (fx.foodPulse = v),
  onDone: () => foodBeatOut.restart()
}))
const foodBeatOut = register(new Tween({
  from: 1, to: 0, duration: 180, curve: easing.inOutSine,
  apply: v => (fx.foodPulse = v)
}))
const foodSparks = register(new Tween({
  from: 0, to: 1, duration: 420, curve: easing.outCubic, apply: v => (fx.foodBurst = v)
}))
const foodScore = register(new Tween({
  from: 0, to: 1, duration: 620, curve: easing.outCubic, apply: v => (fx.scoreBurst = v)
}))
const nearMissEffect = register(new Tween({
  from: 0, to: 1, duration: 720, curve: easing.outCubic, apply: v => (fx.nearMissBurst = v)
}))
const partyBonusEffect = register(new Tween({
  from: 0, to: 1, duration: 900, curve: easing.outCubic, apply: v => (fx.nearMissBurst = v)
}))
const enemyEffect = register(new Tween({
  from: 0, to: 1, duration: 900, curve: easing.outCubic, apply: v => (fx.enemyBurst = v)
}))
const backgroundFlash = register(new Tween({
  from: 0, to: 0, duration: 340, curve: easing.outCubic, apply: v => (fx.backgroundPulse = v)
}))

const splashFadeIn = register(new Tween({
  from: 0, to: 1, duration: 130, curve: easing.outCubic,
  apply: v => (fx.partySplashOpacity = v),
  onDone: () => splashHold.restart()
}))
const splashHold = register(new Tween({
  from: 1, to: 1, duration: 430, curve: easing.linear,
  apply: () => {},
  onDone: () => splashFadeOut.restart()
}))
const splashFadeOut = register(new Tween({
  from: 1, to: 0, duration: 430, curve: easing.inCubic, apply: v => (fx.partySplashOpacity = v)
}))
const splashGrow = register(new Tween({
  from: 0.78, to: 1.08, duration: 990, curve: easing.outCubic, apply: v => (fx.partySplashScale = v)
}))

function startSplash(kind) {
  fx.splashKind = kind
  fx.partySplashOpacity = 0
  fx.partySplashScale = 0.78
  // A boss card has a name, an epithet and a face to take in. A track name
  // does not, so it keeps the shorter original timing.
  const boss = kind === "boss"
  splashHold.duration = boss ? 2100 : 430
  splashFadeIn.duration = boss ? 190 : 130
  splashFadeOut.duration = boss ? 560 : 430
  splashGrow.duration = splashFadeIn.duration + splashHold.duration + splashFadeOut.duration
  splashHold.stop()
  splashFadeOut.stop()
  splashFadeIn.restart()
  splashGrow.restart()
}

// Level transitions pause everything, fade the finished board out, swap and
// respawn while invisible, then fade the next one in beneath the overlay.
const levelFadeIn = register(new Tween({
  from: 0, to: 1, duration: 900, curve: easing.outCubic,
  apply: v => (fx.boardContentOpacity = v),
  onDone: () => {
    if (game.levelTransition && !waitingForLevelBeat) game.completeLevelTransition()
  }
}))
const levelFadeOut = register(new Tween({
  from: 1, to: 0, duration: 750, curve: easing.inOutCubic,
  apply: v => (fx.boardContentOpacity = v),
  onDone: () => {
    game.prepareNextLevel()
    // With music on, the next level starts on a beat rather than on a timer.
    if (music.enabled) {
      waitingForLevelBeat = true
      beatWaitStarted = performance.now()
    } else levelFadeIn.restart()
  }
}))

// The one way into the next level, whether a beat, the timeout or a keypress
// asked for it.
function startNextLevel() {
  waitingForLevelBeat = false
  game.completeLevelTransition()
  levelFadeIn.restart()
}

// Cuts the level-clear screen short. Refused for the first second, so it
// cannot swallow the key that cleared the level or hide the message unread.
function skipLevelTransition() {
  if (!game.levelTransition) return false
  if (performance.now() - levelTransitionStarted < LEVEL_SKIP_AFTER_MS) return false
  if (levelFadeOut.running) {
    // Interrupted mid-fade, so the swap this normally happens after has not
    // run yet. The next level still has to be built before it is shown.
    levelFadeOut.stop()
    game.prepareNextLevel()
  }
  waitingForLevelBeat = false
  levelFadeIn.stop()
  fx.boardContentOpacity = 1
  game.completeLevelTransition()
  return true
}

// --- swapping the soundtrack for a duel --------------------------------------

// Two elements mixed before the analyser, so this is a handover rather than a
// gap. The boss track arrives at full volume and the playlist falls away
// underneath it; coming back is a proper crossfade, since nothing is arriving.
const PLAYING_VOLUME = 0.55

const playlistAway = register(new Tween({
  from: 1, to: 0, duration: 1100, curve: easing.inOutSine,
  apply: value => music.setPlaylistLevel(value),
  onDone: () => music.stopPlaylistElement()
}))

const playlistBack = register(new Tween({
  from: 0, to: 1, duration: 1100, curve: easing.inOutSine,
  apply: value => music.setPlaylistLevel(value)
}))

const bossAway = register(new Tween({
  from: 1, to: 0, duration: 900, curve: easing.inOutSine,
  apply: value => music.setBossLevel(value),
  onDone: () => music.stopBossElement()
}))

function enterBossMusic(index) {
  playlistBack.stop()
  bossAway.stop()
  // No fade on the way in — it starts, and the playlist gets out of the way.
  music.enterBossTrack(index)
  playlistAway.restart({ from: music.playlistLevel })
}

function leaveBossMusic() {
  playlistAway.stop()
  music.leaveBossTrack()
  playlistBack.restart({ from: music.playlistLevel })
  bossAway.restart({ from: music.bossLevel })
}

const musicFade = register(new Tween({
  from: 0, to: 0, duration: 650, curve: easing.inOutSine,
  apply: v => music.setVolume(v)
}))
let musicPauseDelay = 0

// --- game events -------------------------------------------------------------

// Every fresh run asks for its own token, so the clock the server checks
// against is the clock of the run being submitted.
game.on("runStarted", () => {
  charts.startRun()
})

// A challenger arrives with the same fanfare Party Mode gets.
game.on("bossArrived", number => {
  const boss = bossFor(number)
  startSplash("boss")
  announce(`Boss fight. ${boss.name}. ${boss.epithet}`)
  // Alternating, so both boss tracks get used across a run.
  enterBossMusic((number - 1) % Math.max(1, music.bossTrackCount))
})

game.on("bossBitten", (x, y, remaining) => showEnemyBurst(remaining > 1 ? "−1  SEGMENT" : "DISARMED", x, y))

game.on("bossFinishReady", () => announce("Finish him. Press a direction combination."))

// Running into each other nose first: worth announcing, since it looks like
// it should have been fatal and deliberately is not.
game.on("headsCollided", (x, y) => showEnemyBurst("HEADBUTT", x, y))

game.on("ballKicked", (x, y) => {
  fx.burstX = x
  fx.burstY = y
  foodSparks.restart()
})

game.on("goalScored", (x, y, points) => {
  showEnemyBurst(`GOAL!  +${points}`, x, y)
  fx.burstX = x
  fx.burstY = y
  foodSparks.restart()
  announce(`Goal. ${points} points.`)
})

// The only way a duel is lost, so it says which one lost it rather than
// drawing a line from the ordinary pool.
game.on("eatenByBoss", (x, y) => {
  const boss = bossFor(bossNumber(game.displayedLevel))
  pendingGameOverMessage = `${boss.name} ate the last of you. Nothing left to steer.`
  showEnemyBurst("EATEN", x, y)
})

game.on("bossFatality", (name, flavour) => announce(`${name}. ${flavour}`))

game.on("levelCompleted", () => {
  levelTransitionStarted = performance.now()
  levelMessage = pickDifferent(levelMessages, levelMessage)
  announce(`Level ${game.completedLevel} cleared. ${levelMessage}`)
  levelFadeOut.restart()
})

game.on("foodEaten", (x, y, points) => {
  fx.burstX = x
  fx.burstY = y
  fx.scoreBurstText = `+${points}${points > 1 ? " COMBO" : ""}`
  foodSparks.restart()
  foodScore.restart()
})

game.on("discoBallEaten", (x, y) => {
  fx.burstX = x
  fx.burstY = y
  foodSparks.restart()
  if (!music.enabled) music.toggle()
})

game.on("nearMiss", (x, y) => {
  fx.nearMissX = x
  fx.nearMissY = y
  fx.nearMissKind = "tailgate"
  partyBonusEffect.stop()
  nearMissEffect.restart()
})

game.on("partyBonus", (name, points, x, y) => {
  fx.nearMissX = x
  fx.nearMissY = y
  fx.nearMissKind = "bonus"
  fx.partyBonusText = `+${points}  ${name}`
  nearMissEffect.stop()
  partyBonusEffect.restart()
})

game.on("snakeBitten", (x, y) => showEnemyBurst("−1  CHOMPED", x, y))
game.on("snakeEaterDefeated", (x, y) => showEnemyBurst("+2  PREDATOR", x, y))
game.on("partyEvent", (name, x, y) => showEnemyBurst(name, x, y))

function showEnemyBurst(text, x, y) {
  fx.enemyBurstX = x
  fx.enemyBurstY = y
  fx.enemyBurstText = text
  enemyEffect.restart()
}

game.on("statusChanged", () => {
  if (!game.levelTransition && waitingForLevelBeat) {
    waitingForLevelBeat = false
    levelFadeOut.stop()
    levelFadeIn.stop()
    fx.boardContentOpacity = 1
  }
  // Level transitions leave playback completely alone. Pause and death fade to
  // silence before suspending the player.
  // The handover moves the mix between the two elements; this moves the volume
  // of both. They no longer have anything to argue about.
  // ...and none of it while two players are on the board. Entering a match
  // pauses the run, which through here would fade the music out and tell the
  // controller the game is over — so Party Mode would turn on and play
  // nothing. The match owns the music while it is up.
  if (!game.levelTransition && !twoPlayer()) {
    musicPauseDelay = 0
    musicFade.stop()
    if (game.running && !game.gameOver) {
      music.setGameActive(true)
      musicFade.restart({ from: music.volume, to: PLAYING_VOLUME })
    } else {
      musicFade.restart({ from: music.volume, to: 0 })
      musicPauseDelay = musicFade.duration
    }
  }
  if (game.gameOver && !gameOverMessageChosen) {
    gameOverMessage = pendingGameOverMessage || pickDifferent(gameOverMessages, gameOverMessage)
    pendingGameOverMessage = null
    gameOverMessageChosen = true
    announce(`Game over. Score ${game.score}. ${gameOverMessage}`)
    if (game.score > 0 && !game.practiceRun) {
      ownRun = { score: game.score, mode: game.endlessMode ? "endless" : "levels", party: music.enabled }
      // Anything that failed earlier goes along with it.
      charts.submit(ownRun)
      chartsLoadedAt = Date.now()
    }
  } else if (!game.gameOver) {
    gameOverMessageChosen = false
  }
})

// --- music events ------------------------------------------------------------

music.on("strongBeat", strength => {
  // In a race the beat belongs to one lane: this browser's own. Online it is
  // reported to the room, because the room has no ears — which does mean a
  // beat is taken on trust, and is why it can only ever open a window on the
  // lane of the seat that sent it.
  if (twoPlayer()) {
    reportBeat(strength)
    return
  }
  game.registerStrongBeat(strength)
  if (waitingForLevelBeat) startNextLevel()
  fx.recordDanceBeat(strength)
  backgroundFlash.restart({ from: 0.07 + strength * 0.08, to: 0 })
})

music.on("onset", () => foodBeatIn.restart())

music.on("enabledChanged", () => {
  game.setPartyMode(music.enabled)
  if (music.enabled) {
    if (!twoPlayer()) startSplash("party")
  } else {
    if (waitingForLevelBeat) {
      waitingForLevelBeat = false
      levelFadeIn.restart()
    }
    foodBeatIn.stop()
    foodBeatOut.stop()
    fx.foodPulse = 0
    fx.danceHistory = []
    backgroundFlash.stop()
    fx.backgroundPulse = 0
  }
  updateHud()
})

music.on("trackChanged", updateHud)
music.on("blocked", () => announce("The browser blocked audio. Press P again to start Party Mode."))

// --- input -------------------------------------------------------------------

const STEERING = new Map([
  ["ArrowLeft", [-1, 0]], ["h", [-1, 0]], ["a", [-1, 0]],
  ["ArrowRight", [1, 0]], ["l", [1, 0]], ["d", [1, 0]],
  ["ArrowUp", [0, -1]], ["k", [0, -1]], ["w", [0, -1]],
  ["ArrowDown", [0, 1]], ["j", [0, 1]], ["s", [0, 1]]
])

addEventListener("keydown", event => {
  if (event.ctrlKey || event.metaKey || event.altKey) return
  // Typing a level is typing, not steering.
  if (event.target instanceof HTMLInputElement) return
  // With the charts up, the board is not the thing being looked at. Escape is
  // left to the dialog, which closes on it by itself.
  if (chartsDialog.open) {
    if (event.key.toLowerCase() === "c") {
      closeCharts()
      event.preventDefault()
    }
    return
  }
  // Same again: with the duel dialog up, the arrows are not steering anything.
  if (versusDialog.open) {
    if (event.key === "2") {
      closeVersusDialog()
      event.preventDefault()
    }
    return
  }
  // A duel has its own keyboard: two sets of steering keys, and none of the
  // single-player switches, which would be somebody changing the rules of a
  // match somebody else is in the middle of.
  if (twoPlayer()) {
    if (versusKey(event)) event.preventDefault()
    updateHud()
    return
  }
  // Any key gets on with it, and does nothing else — nobody means to switch
  // mode with the key they pressed to leave the level-clear screen.
  if (skipLevelTransition()) {
    event.preventDefault()
    updateHud()
    return
  }
  const key = event.key
  const steer = STEERING.get(key.length === 1 ? key.toLowerCase() : key)
  if (steer) game.turn(steer[0], steer[1])
  else if (key === " ") game.togglePause()
  else if (key === "Escape") pauseIfRunning()
  else {
    switch (key.toLowerCase()) {
      case "r": game.reset(); break
      case "m": game.toggleMode(); break
      case "b": game.toggleWallsWrap(); break
      case "f": game.cycleFoodStyle(foods.length); break
      case "p": music.toggle(); break
      case "n": music.nextTrack(); break
      case "t": cycleTheme(); break
      case "v": toggleFullscreen(); break
      case "c": openCharts(); break
      case "2": openVersus(); break
      case "g": jumpToNextBoss(); break
      default: return
    }
  }
  event.preventDefault()
  updateHud()
})

// Escape has no window to close here. Real fullscreen is the browser's to
// exit, but the CSS stand-in has to be told; failing that, Escape does the
// useful half of what it does on the desktop and stops the game.
function pauseIfRunning() {
  if (stage.classList.contains("faux")) {
    setFaux(false)
    return
  }
  if (twoPlayer()) {
    leaveTwoPlayer()
    return
  }
  if (game.running && !game.gameOver) game.togglePause()
}

// A tap cycles the food skin, exactly as clicking the board does on the
// desktop. A drag steers, because a phone has no arrow keys.
let touch = null
canvas.addEventListener("pointerdown", event => {
  touch = { x: event.clientX, y: event.clientY, steered: false }
  canvas.setPointerCapture(event.pointerId)
})
canvas.addEventListener("pointermove", event => {
  if (!touch) return
  const dx = event.clientX - touch.x
  const dy = event.clientY - touch.y
  if (Math.abs(dx) < 24 && Math.abs(dy) < 24) return
  if (match) {
    if (Math.abs(dx) > Math.abs(dy)) steerVersus(touchSeat(), Math.sign(dx), 0)
    else steerVersus(touchSeat(), 0, Math.sign(dy))
  } else if (Math.abs(dx) > Math.abs(dy)) game.turn(Math.sign(dx), 0)
  else game.turn(0, Math.sign(dy))
  touch = { x: event.clientX, y: event.clientY, steered: true }
})
canvas.addEventListener("pointerup", () => {
  // A phone has no key to press, so a tap is how it gets on with it there.
  if (touch && !touch.steered) {
    if (twoPlayer()) versusSpace()
    else if (!skipLevelTransition()) game.cycleFoodStyle(foods.length)
  }
  updateHud()
  touch = null
})
canvas.addEventListener("contextmenu", event => event.preventDefault())

// Dropped audio files stand in for the desktop's user music directory.
addEventListener("dragover", event => event.preventDefault())
addEventListener("drop", event => {
  event.preventDefault()
  const added = music.addLocalTracks(event.dataTransfer?.files || [])
  if (added) {
    announce(`Added ${added} track${added === 1 ? "" : "s"} to the playlist.`)
    if (!music.enabled) music.toggle()
  }
  updateHud()
})

// --- buttons -----------------------------------------------------------------

const buttons = [
  { id: "mode", letter: "M", rest: () => `ode: ${game.endlessMode ? "Endless" : "Levels"}`,
    name: () => `Mode: ${game.endlessMode ? "Endless" : "Levels"}`, act: () => game.toggleMode() },
  { id: "borders", letter: "B", rest: () => `orders: ${game.wallsWrap ? "Wrap" : "Solid"}`,
    name: () => `Borders: ${game.wallsWrap ? "Wrap" : "Solid"}`, act: () => game.toggleWallsWrap() },
  { id: "food", letter: "F", rest: () => `ood: ${foods[game.foodStyleIndex % foods.length].glyph}`,
    name: () => "Food style", act: () => game.cycleFoodStyle(foods.length),
    family: () => foods[game.foodStyleIndex % foods.length].family },
  { id: "party", letter: "P", rest: () => `arty Mode: ${music.enabled ? "On" : "Off"}`,
    name: () => `Party Mode: ${music.enabled ? "On" : "Off"}`, act: () => music.toggle() },
  { id: "next", letter: "N", rest: () => `ext: ${music.trackName}`,
    name: () => `Next soundtrack, currently ${music.trackName}`, act: () => music.nextTrack() },
  { id: "theme", letter: "T", rest: () => `heme: ${theme.name}`,
    name: () => `Theme: ${theme.name}`, act: () => cycleTheme() },
  // Not "Fullscreen", because bolding its first letter would claim `f`, which
  // has cycled the food skin since the desktop version.
  { id: "view", letter: "V", rest: () => `iew: ${isFullscreen() ? "Fullscreen" : "Windowed"}`,
    name: () => `View: ${isFullscreen() ? "Fullscreen" : "Windowed"}`, act: () => toggleFullscreen() },
  { id: "charts-open", letter: "C", rest: () => "harts",
    name: () => "Charts, the highest scores", act: () => openCharts() },
  // The way in and, while a duel is up, the way out. One button, because the
  // controls row decides how much height is left for the board.
  { id: "versus", letter: "2", rest: () => (twoPlayer() ? " Players: Leave" : " Players"),
    name: () => (twoPlayer() ? "Leave two players" : "Two players, here or online"),
    act: () => openVersus() }
]

for (const button of buttons) {
  el(button.id).addEventListener("click", () => {
    button.act()
    updateHud()
  })
}

// --- trying a level out ------------------------------------------------------

// Only on a machine you are developing on. There is deliberately no way to
// switch this on for the deployed game — not a query parameter, not a stored
// flag — because a way to reach a boss without playing nine levels first is
// also a way to reach a score without playing at all. The run it produces is
// refused by the charts as well, but this is the part that has to hold.
const debugKeys = location.hostname === "localhost"
  || location.hostname === "127.0.0.1"
  || location.hostname === "[::1]"
  || location.protocol === "file:"

function jumpToNextBoss() {
  jumpTo(nextBossLevel(game.displayedLevel))
}

// Takes "3.2", "3-2", or a plain level number. Endless has no levels to go to,
// so it switches out of it first, and the run is never charted afterwards.
function jumpTo(target) {
  if (!debugKeys) return false
  const level = typeof target === "number" ? target : levelFromName(target)
  if (!level) return false
  if (game.endlessMode) game.toggleMode()
  game.jumpToLevel(level)
  const challenger = game.bossLevel ? `, ${bossFor(bossNumber(level)).name}` : ""
  announce(`Jumped to level ${levelName(level)}${challenger}. This run will not be charted.`)
  updateHud()
  return true
}

// The strip exists only on a development machine, and the level in the URL is
// read on the same terms.
const devBar = el("dev")
if (debugKeys) {
  devBar.hidden = false
  devBar.addEventListener("submit", event => {
    event.preventDefault()
    const wanted = el("dev-level").value
    const level = levelFromName(wanted)
    el("dev-note").textContent = jumpTo(wanted) ? `at ${levelName(level)}` : `${wanted || "that"}?`
    el("dev-level").blur()
  })
}

// --- charts ------------------------------------------------------------------

const chartsDialog = el("charts")
const chartsList = el("charts-list")
const chartsNote = el("charts-note")
const charts = new Charts({ store, onChange: () => renderCharts() })

let chartsPeriod = "day"
let chartsLoadedAt = 0
// The run just finished, so it can be pointed out in the list it landed in.
let ownRun = null

function openCharts() {
  // A modal over a moving board is how a run ends without anybody watching.
  if (game.running && !game.gameOver) game.togglePause()
  if (!chartsDialog.open) chartsDialog.showModal()
  if (Date.now() - chartsLoadedAt > 30000) {
    chartsLoadedAt = Date.now()
    charts.load()
  }
  renderCharts()
}

function closeCharts() {
  if (chartsDialog.open) chartsDialog.close()
}

function renderCharts() {
  for (const tab of chartsDialog.querySelectorAll(".tab"))
    tab.setAttribute("aria-selected", String(tab.dataset.period === chartsPeriod))

  const board = charts.boards?.[chartsPeriod]
  chartsList.replaceChildren()

  if (charts.state === "loading" && !charts.boards) {
    chartsNote.textContent = "Reading the charts…"
    return
  }
  if (charts.state === "error" && !charts.boards) {
    chartsNote.textContent = "The charts are not answering. Your run is saved and will be sent later."
    return
  }
  if (!board?.length) {
    chartsNote.textContent = `Nothing in the last ${PERIOD_LABELS[chartsPeriod].toLowerCase()} yet. Go on then.`
    return
  }

  const now = Date.now()
  for (const entry of board) {
    const row = document.createElement("li")
    if (ownRun && entry.score === ownRun.score && entry.mode === ownRun.mode && entry.party === ownRun.party
      && Math.abs(now - Date.parse(`${entry.at.replace(" ", "T")}Z`)) < 120000) {
      row.className = "mine"
    }
    const rank = document.createElement("span")
    rank.className = "rank"
    rank.textContent = `${entry.rank}.`
    const middle = document.createElement("span")
    const score = document.createElement("span")
    score.className = "score"
    score.textContent = entry.score
    const run = document.createElement("span")
    run.className = "run"
    run.textContent = `  ${describeRun(entry)}`
    middle.append(score, run)
    const when = document.createElement("span")
    when.className = "when"
    when.textContent = relativeTime(entry.at, now)
    row.append(rank, middle, when)
    chartsList.append(row)
  }
  chartsNote.textContent = `Top ${board.length} of ${charts.runs.toLocaleString("en")} runs. No names, no accounts — just the number.`
}

for (const tab of chartsDialog.querySelectorAll(".tab")) {
  tab.addEventListener("click", () => {
    chartsPeriod = tab.dataset.period
    renderCharts()
  })
}
el("charts-close").addEventListener("click", closeCharts)

// --- two players -------------------------------------------------------------

// Two games live here, for two to four players. A duel puts every snake on one
// board and lets them ruin each other; a race gives each a board of its own and
// sends them up the levels. Both models present the same handful of methods, so
// almost everything below is written once and `matchMode` only decides which
// one gets built and which draw call paints it.
//
// While either is up the single-player game is simply not running: nothing
// ticks it, nothing draws it, and nothing it did not do can reach its best
// score or the charts.
let match = null
let matchMode = "race"
// "hotseat" or "online". The difference is who runs the board and how many
// snakes this keyboard is steering.
let versusKind = null
let versusSeat = null
let net = null
// How many race boards fit on a row. Decided by whichever arrangement leaves
// the biggest cell, which on a phone held upright is one.
let raceAcross = 2

// The lobby is what is on screen before a board is. Online it is the room's,
// arriving as a message; at one keyboard it is built here and never leaves.
let inLobby = false
let lobbyState = null
let lobbyNote = ""

const versusDialog = el("versus-dialog")
const versusNoteText = el("versus-note")
const versusShare = el("versus-share")
const versusLink = el("versus-link")
const lobbyPanel = el("lobby")
const lobbySeats = el("lobby-seats")
const chatLog = el("chat-log")

const twoPlayer = () => inLobby || match !== null
const online = () => versusKind === "online"

// Which seats are in the match. Online the room decides; at one keyboard it is
// however many people said they were here.
const localPresence = () => SEATS.map(seat => seat < hotseatCount)
const seatCount = () => (match ? match.seated.length : online() ? MAX_SEATS : hotseatCount)

// --- what each seat looks like and is called ---

const headKey = seat => `omasnake/versus/head${seat}`
const nickKey = seat => `omasnake/versus/nick${seat}`

const SEATS = [...Array(MAX_SEATS).keys()]
const versusHeads = SEATS.map(seat => {
  const stored = store.getItem(headKey(seat))
  return stored === null ? DEFAULT_HEADS[seat % DEFAULT_HEADS.length] : validHead(stored)
})
const versusNicks = SEATS.map(seat => store.getItem(nickKey(seat)) || "")
const partyKey = seat => `omasnake/versus/party${seat}`
const versusParty = SEATS.map(seat => store.getItem(partyKey(seat)) === "true")
// How many players are at this keyboard, and how many rounds the match is.
let hotseatCount = Math.min(MAX_SEATS, Math.max(MIN_SEATS,
  Number(store.getItem("omasnake/versus/players")) || MIN_SEATS))
let winsNeeded = Math.min(5, Math.max(1, Number(store.getItem("omasnake/versus/wins")) || 3))

// One set of still effects per lane, made once. A race draws two boards with
// the single-player renderer, and it wants two of everything that renderer
// reads — but none of the tweens, which belong to one board being watched.
const laneFx = SEATS.map(() => laneEffects())

function remember(key, value) {
  try {
    store.setItem(key, value)
  } catch {
    // A locked-down origin costs somebody their name next time, and nothing
    // else. Not worth losing the choice they just made over.
  }
}

// Who a seat is, said the way this browser should say it.
const versusLabel = seat => {
  const nick = lobbyState?.players?.[seat]?.nick
  if (nick) return nick
  return online() ? (seat === versusSeat ? "You" : "They") : `Player ${seat + 1}`
}

// --- the doorway ---

function openVersus() {
  if (twoPlayer()) {
    leaveTwoPlayer()
    return
  }
  versusShare.hidden = true
  versusNoteText.textContent = ""
  if (!versusDialog.open) versusDialog.showModal()
}

function closeVersusDialog() {
  if (versusDialog.open) versusDialog.close()
}

// A match is a game being played, whatever the paused single-player run has to
// say about it. Without this the music controller thinks nothing is happening,
// and `toggle()` sets a flag and plays nothing at all.
function musicFollows(active) {
  musicPauseDelay = 0
  musicFade.stop()
  if (active) {
    music.setGameActive(true)
    musicFade.restart({ from: music.volume, to: PLAYING_VOLUME })
  } else {
    musicFade.restart({ from: music.volume, to: 0 })
    musicPauseDelay = musicFade.duration
  }
}

function enterTwoPlayer(kind) {
  // Whatever the single-player run was doing, it is not doing it now. Saving
  // first means a run interrupted by a duel keeps its lifetime playtime.
  if (game.running && !game.gameOver) game.togglePause()
  game.saveSettings()

  versusKind = kind
  versusSeat = kind === "hotseat" ? null : versusSeat
  match = null
  inLobby = true
  document.body.classList.add("versus")
  musicFollows(true)
  closeVersusDialog()
  resize()
  renderLobby()
  updateHud()
}

function leaveTwoPlayer() {
  if (net) {
    net.close()
    net = null
  }
  match = null
  inLobby = false
  lobbyState = null
  lobbyNote = ""
  versusKind = null
  versusSeat = null
  chatLog.replaceChildren()
  document.body.classList.remove("versus")
  // The run underneath is paused, so the music goes quiet the way it would
  // have if it had never been interrupted.
  musicFollows(false)
  renderLobby()
  resize()
  updateHud()
  announce("Back to one player.")
}

// --- at one keyboard ---

function startHotseat() {
  enterTwoPlayer("hotseat")
  lobbyState = {
    mode: matchMode,
    spectators: 0,
    players: SEATS.map(seat => ({
      seat,
      here: seat < hotseatCount,
      nick: versusNicks[seat],
      head: versusHeads[seat],
      party: versusParty[seat],
      ready: false
    }))
  }
  renderLobby()
  announce("Players at one keyboard. Pick how many, a face each, then start.")
}

function startLocalMatch() {
  match = makeMatch()
  match.setPresent(localPresence())
  match.startMatch()
  for (const seat of SEATS) {
    match.setHead(seat, versusHeads[seat])
    match.setParty?.(seat, versusParty[seat])
  }
  inLobby = false
  renderLobby()
  resize()
  updateHud()
}

function makeMatch() {
  const options = { wrap: game.wallsWrap, winsNeeded, present: localPresence() }
  const model = matchMode === "race" ? new Race(options) : new Versus(options)
  model.on("roundOver", winner => announceRound(winner))
  model.on("matchOver", winner => announce(`${versusLabel(winner)} wins the match.`))
  // A bonus nobody sees is a bonus nobody plays for, and a lane has no tweens
  // of its own, so the burst is set here and decayed by the frame loop.
  model.on("bonus", (seat, name, points) => showLaneBonus(seat, `+${points} ${name}`))
  return model
}

// The one animated thing a lane has. `draw` already knows how to paint it — it
// is the same burst Party Mode uses for a bonus in a single-player run.
function showLaneBonus(seat, text) {
  const lane = laneFx[seat]
  if (!lane) return
  const player = match?.players?.[seat]
  const head = (matchMode === "race" ? player?.game?.snake?.[0] : player?.snake?.[0]) || { x: 0, y: 0 }
  lane.partyBonusText = text
  lane.nearMissKind = "bonus"
  lane.nearMissX = head.x
  lane.nearMissY = head.y
  lane.nearMissBurst = 0
}

function announceRound(winner) {
  if (!match) return
  announce(winner === -1
    ? `Round ${match.round}: nobody takes it.`
    : `Round ${match.round} to ${versusLabel(winner)}.`)
}

// --- in a room ---

function joinRoom(code) {
  const wanted = String(code || "").trim().toLowerCase()
  if (!validCode(wanted)) {
    versusNoteText.textContent = "A room code is 4 to 12 letters or digits."
    return
  }
  enterTwoPlayer("online")
  el("lobby-link").value = roomLink(wanted)
  lobbyNote = "connecting…"

  net = new Net({
    onWelcome: message => {
      versusSeat = message.seat
      matchMode = message.mode || matchMode
      lobbyNote = message.seat === null ? "both seats taken — you are watching" : ""
      // The room decides which seat this is, so what to ask for is only
      // knowable once it has said.
      if (versusSeat !== null) {
        net.setHead(versusHeads[versusSeat])
        net.setParty(versusParty[versusSeat])
        if (versusSeat === 0) net.setWins(winsNeeded)
        if (versusNicks[versusSeat]) net.setNick(versusNicks[versusSeat])
      }
      renderLobby()
      updateHud()
    },
    onLobby: message => {
      lobbyState = message
      matchMode = message.mode
      renderLobby()
      updateHud()
    },
    onState: (state, mode) => {
      matchMode = mode || matchMode
      if (!state) {
        // No match in the room. Whatever board was on screen belonged to one
        // that has been abandoned, so the lobby is what is there now.
        match = null
        if (!inLobby) {
          inLobby = true
          resize()
        }
        renderLobby()
        // A room with no match in it is a room back in its lobby.
        updateHud()
        return
      }
      if (!match || match.snapshot().mode !== state.mode) match = makeMatch()
      match.applySnapshot(state)
      if (inLobby) {
        inLobby = false
        renderLobby()
        resize()
      }
      updateHud()
    },
    onChat: entry => addChatLine(entry),
    onChatLog: messages => {
      chatLog.replaceChildren()
      for (const entry of messages) addChatLine(entry)
    },
    onLeft: seat => {
      lobbyNote = `${versusLabel(seat)} left — waiting for somebody else`
      announce(lobbyNote)
      renderLobby()
    },
    onStatus: status => {
      if (status === "connecting") lobbyNote = "connecting…"
      else if (status === "failed") lobbyNote = "could not reach the room"
      else if (status === "dropped") lobbyNote = "connection lost — rejoin from 2 Players"
      renderLobby()
      updateHud()
    }
  })
  net.connect(wanted, { wrap: game.wallsWrap })
}

function createRoom() {
  const code = newRoomCode()
  versusShare.hidden = false
  versusLink.value = roomLink(code)
  versusNoteText.textContent = `Room ${code.toUpperCase()}.`
  joinRoom(code)
}

// --- the lobby, drawn ---

// The lobby is built once and updated in place from then on. Rebuilding it per
// message is what it used to do, and every keystroke in a name field sent a
// message, which came back as a lobby, which replaced the field being typed
// in — so the caret was thrown out after every letter. Nothing here may
// replace a node that somebody might be typing into.
const HEAD_PREVIEW = 30
const seatNodes = []

function buildChoice(box, values, choose) {
  box.replaceChildren()
  return values.map(value => {
    const button = document.createElement("button")
    button.type = "button"
    button.textContent = String(value)
    button.addEventListener("click", () => choose(value))
    box.append(button)
    return { button, value }
  })
}

let playerChoices = []
let winsChoices = []

function buildLobby() {
  playerChoices = buildChoice(el("players-options"), [2, 3, 4], choosePlayers)
  winsChoices = buildChoice(el("wins-options"), [1, 2, 3, 4, 5], chooseWins)

  lobbySeats.replaceChildren()
  seatNodes.length = 0

  for (const seat of SEATS) {
    const card = document.createElement("div")
    card.className = `seat seat-${seat}`

    const top = document.createElement("div")
    top.className = "seat-top"
    const who = document.createElement("span")
    who.className = "seat-who"
    const state = document.createElement("span")
    state.className = "seat-state"
    top.append(who, state)

    // Both the field and the label exist from the start, and which of them is
    // shown depends on whose seat it is. Swapping one for the other would mean
    // creating a node, which is the thing that must not happen here.
    const input = document.createElement("input")
    input.type = "text"
    input.maxLength = 16
    input.autocomplete = "off"
    input.placeholder = `Player ${seat + 1}`
    input.value = versusNicks[seat]
    input.setAttribute("aria-label", `Name for player ${seat + 1}`)
    input.addEventListener("input", () => chooseNick(seat, input.value))

    const name = document.createElement("div")
    name.className = "seat-name"

    // Party Mode is per player here, which it has never been anywhere else in
    // this game: it changes what scores on that board and nothing on the other.
    const party = document.createElement("button")
    party.type = "button"
    party.className = "seat-party"
    party.addEventListener("click", () => chooseParty(seat, !versusParty[seat]))

    // Which keys this seat steers with, which is worth saying once where the
    // player is choosing their name rather than nowhere at all.
    const keys = document.createElement("span")
    keys.className = "seat-keys"

    const options = document.createElement("div")
    options.className = "heads-options"
    const heads = HEADS.map((style, index) => {
      const button = document.createElement("button")
      button.type = "button"
      button.className = "head"
      // A canvas has nothing for a screen reader to read, so the name the
      // roster carries is what the button is called.
      button.setAttribute("aria-label", style.name)
      const canvas = document.createElement("canvas")
      button.append(canvas)
      button.addEventListener("click", () => chooseHead(seat, index))
      options.append(button)
      return { button, canvas }
    })

    card.append(top, input, name, options, party, keys)
    lobbySeats.append(card)
    seatNodes.push({ card, who, state, input, name, heads, party, keys })
  }
  paintHeads()
}

// The faces are drawn rather than styled, so they are repainted when the
// palette changes and at no other time — twelve canvases per lobby message
// would be a great deal of painting for a board that has not changed.
function paintHeads() {
  const ratio = Math.min(3, devicePixelRatio || 1)
  seatNodes.forEach((nodes, seat) => {
    nodes.heads.forEach(({ canvas }, index) => {
      canvas.width = Math.round(HEAD_PREVIEW * ratio)
      canvas.height = Math.round(HEAD_PREVIEW * ratio)
      canvas.style.width = `${HEAD_PREVIEW}px`
      canvas.style.height = `${HEAD_PREVIEW}px`
      const context = canvas.getContext("2d")
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      drawHeadPreview(context, { theme, seat, head: index, size: HEAD_PREVIEW })
    })
  })
}

function chooseHead(seat, index) {
  versusHeads[seat] = validHead(index)
  remember(headKey(seat), versusHeads[seat])
  if (online()) net?.setHead(versusHeads[seat])
  else if (lobbyState) lobbyState.players[seat].head = versusHeads[seat]
  renderLobby()
}

// One message per keystroke would be within the room's budget and still be a
// message per keystroke. The name is kept here at once and told to the room
// once the typing stops.
let nickTimer = 0
function chooseParty(seat, on) {
  versusParty[seat] = !!on
  remember(partyKey(seat), versusParty[seat])
  // Party Mode has meant music since the desktop version, and a party with no
  // music is most of the point missing. The click that asked for it is the
  // gesture playback needs, so this is the one moment it can be started from.
  if (versusParty[seat] && !music.enabled) music.toggle()
  if (online()) net?.setParty(versusParty[seat])
  else if (lobbyState?.players?.[seat]) lobbyState.players[seat].party = versusParty[seat]
  renderLobby()
}

function chooseWins(count) {
  winsNeeded = Math.min(5, Math.max(1, count))
  remember("omasnake/versus/wins", winsNeeded)
  if (online()) net?.setWins(winsNeeded)
  renderLobby()
}

function choosePlayers(count) {
  hotseatCount = Math.min(MAX_SEATS, Math.max(MIN_SEATS, count))
  remember("omasnake/versus/players", hotseatCount)
  if (lobbyState) {
    lobbyState.players = SEATS.map(seat => ({
      seat,
      here: seat < hotseatCount,
      nick: versusNicks[seat],
      head: versusHeads[seat],
      party: versusParty[seat],
      ready: false
    }))
  }
  renderLobby()
}

function chooseNick(seat, value) {
  versusNicks[seat] = value.slice(0, 16)
  remember(nickKey(seat), versusNicks[seat])
  if (lobbyState?.players?.[seat]) lobbyState.players[seat].nick = versusNicks[seat]
  if (!online()) return
  clearTimeout(nickTimer)
  nickTimer = setTimeout(() => net?.setNick(versusNicks[seat]), 300)
}

function renderLobby() {
  lobbyPanel.hidden = !inLobby
  if (!inLobby) return

  const isOnline = online()
  el("lobby-invite").hidden = !isOnline
  el("lobby-chat").hidden = !isOnline
  el("lobby-note").textContent = lobbyNote

  // Only the first seat picks the game, and only in a room where there is
  // somebody else to disagree with.
  for (const button of el("lobby-modes").querySelectorAll(".mode")) {
    button.setAttribute("aria-pressed", String(button.dataset.mode === matchMode))
    button.disabled = isOnline && versusSeat !== 0
  }

  const players = lobbyState?.players || SEATS.map(seat => ({
    seat,
    here: !isOnline && seat < hotseatCount,
    nick: versusNicks[seat],
    head: versusHeads[seat],
    party: versusParty[seat],
    ready: false
  }))

  // How many are playing is a decision only somebody at the keyboard makes;
  // online it is however many turned up. Rounds are the first seat's call.
  el("choice-players").hidden = isOnline
  for (const { button, value } of playerChoices) {
    button.setAttribute("aria-pressed", String(value === hotseatCount))
  }
  const rounds = lobbyState?.winsNeeded ?? winsNeeded
  for (const { button, value } of winsChoices) {
    button.setAttribute("aria-pressed", String(value === rounds))
    button.disabled = isOnline && versusSeat !== 0
  }

  seatNodes.forEach((nodes, seat) => {
    const player = players[seat]
    const mine = (!isOnline && player.here) || (isOnline && seat === versusSeat)

    // A seat nobody is in still shows, so it is obvious there is room.
    nodes.card.hidden = !isOnline && !player.here
    nodes.card.className = `seat seat-${seat}${player.ready ? " ready" : ""}${player.here ? "" : " empty"}`
    nodes.keys.textContent = player.here && !isOnline ? SEAT_KEY_NAMES[seat] : ""
    nodes.who.textContent = isOnline
      ? (seat === versusSeat ? `P${seat + 1} — YOU` : `P${seat + 1}`)
      : `PLAYER ${seat + 1}`
    nodes.state.textContent = !player.here
      ? "empty"
      : player.ready ? "ready" : isOnline ? "not ready" : ""

    nodes.input.hidden = !mine
    nodes.name.hidden = mine
    // Never while it is being typed into, and never when it already says this.
    if (mine && document.activeElement !== nodes.input && nodes.input.value !== versusNicks[seat]) {
      nodes.input.value = versusNicks[seat]
    }
    // textContent, never innerHTML: this is a name somebody else typed.
    if (!mine) nodes.name.textContent = player.nick || (player.here ? `Player ${seat + 1}` : "waiting…")

    const chosen = mine ? versusHeads[seat] : player.head
    nodes.heads.forEach(({ button }, index) => {
      button.setAttribute("aria-pressed", String(chosen === index))
      button.disabled = !mine
    })

    // Only a race has one. A duel is the same game for all of them.
    const partyOn = mine ? versusParty[seat] : !!player.party
    nodes.party.hidden = matchMode !== "race" || !player.here
    nodes.party.disabled = !mine
    nodes.party.setAttribute("aria-pressed", String(partyOn))
    nodes.party.textContent = partyOn ? "🎉 Party Mode on" : "Party Mode off"
  })

  const ready = el("lobby-ready")
  if (isOnline) {
    const mine = versusSeat === null ? null : players[versusSeat]
    const here = players.filter(player => player.here).length
    ready.hidden = versusSeat === null
    ready.disabled = here < MIN_SEATS
    ready.textContent = here < MIN_SEATS
      ? "Waiting for a second player"
      : mine?.ready ? "Not ready" : "Ready"
  } else {
    ready.hidden = false
    ready.disabled = false
    ready.textContent = "Start"
  }
}

buildLobby()

// --- chat ---

function addChatLine(entry) {
  const line = document.createElement("li")
  const mine = entry.seat !== null && entry.seat === versusSeat
  if (!mine) line.className = "them"
  const who = document.createElement("span")
  who.className = "who"
  // Both of these are text somebody else typed. They are set as text nodes and
  // never as markup, which is the whole of the defence and all it needs to be.
  who.textContent = `${entry.nick}: `
  line.append(who, document.createTextNode(entry.text))
  chatLog.append(line)
  while (chatLog.childElementCount > 60) chatLog.removeChild(chatLog.firstElementChild)
  chatLog.scrollTop = chatLog.scrollHeight
}

// --- steering ---

// One set of keys per seat at the same keyboard: arrows, W A S D, I J K L and
// the number pad. The vi keys the single-player game steers with are not among
// them — `j`, `k` and `l` belong to the third player here, and a run is the
// place to keep them. Online there is one snake to steer and the first two
// sets both steer it, because insisting on one would be a rule with nothing
// behind it.
const SEAT_KEYS = [
  new Map([["ArrowLeft", [-1, 0]], ["ArrowRight", [1, 0]], ["ArrowUp", [0, -1]], ["ArrowDown", [0, 1]]]),
  new Map([["a", [-1, 0]], ["d", [1, 0]], ["w", [0, -1]], ["s", [0, 1]]]),
  new Map([["j", [-1, 0]], ["l", [1, 0]], ["i", [0, -1]], ["k", [0, 1]]]),
  // By `code`, because a number pad reports whatever Num Lock felt like.
  new Map([["Numpad4", [-1, 0]], ["Numpad6", [1, 0]], ["Numpad8", [0, -1]], ["Numpad5", [0, 1]]])
]

const SEAT_KEY_NAMES = ["arrows", "W A S D", "I J K L", "number pad"]

const touchSeat = () => (online() ? versusSeat : 0)

// One keyboard has one set of speakers, so a hot-seat beat reaches both lanes
// that asked for a party; online it reaches only this browser's own.
function reportBeat(strength) {
  if (!match?.registerBeat) return
  if (online()) {
    net?.beat(strength)
    return
  }
  for (const seat of [0, 1]) match.registerBeat(seat, strength)
}

function steerVersus(seat, dx, dy) {
  if (seat === null || seat === undefined || !match) return
  if (online()) {
    // The room decides whether the turn is legal, and the room's copy of the
    // board is the one that counts. Turning the local one as well would only
    // be a guess that the next frame contradicts.
    net?.turn(dx, dy)
    return
  }
  match.turn(seat, dx, dy)
}

// Space starts the next match, the same key that restarts a single-player run.
function versusSpace() {
  if (inLobby) {
    pressReady()
    return
  }
  if (!match || match.phase !== PHASE_MATCH_OVER) return
  if (online()) net?.rematch()
  else match.startMatch()
}

function pressReady() {
  if (!online()) {
    startLocalMatch()
    return
  }
  if (versusSeat === null) return
  const mine = lobbyState?.players?.[versusSeat]
  net?.setReady(!mine?.ready)
}

function versusKey(event) {
  const key = event.key
  const lower = key.length === 1 ? key.toLowerCase() : key
  if (!inLobby) {
    for (let seat = 0; seat < SEAT_KEYS.length; ++seat) {
      const turn = SEAT_KEYS[seat].get(lower) || SEAT_KEYS[seat].get(event.code)
      if (!turn) continue
      // Online every set of keys is yours, because only one snake is.
      if (online()) {
        if (seat > 1) continue
        steerVersus(versusSeat, turn[0], turn[1])
      } else steerVersus(seat, turn[0], turn[1])
      return true
    }
  }
  if (key === " ") {
    versusSpace()
    return true
  }
  if (key === "Escape") {
    pauseIfRunning()
    return true
  }
  // The switches that are about this screen rather than about the match. The
  // music is among them now that Party Mode is a lobby choice rather than the
  // music button: a party with nothing playing is most of the point missing,
  // and there has to be a way to start it without leaving the game.
  switch (lower) {
    case "p": music.toggle(); return true
    case "n": music.nextTrack(); return true
    case "t": cycleTheme(); return true
    case "v": toggleFullscreen(); return true
    case "2": leaveTwoPlayer(); return true
    default: return false
  }
}

// --- the two-player frame ---

function advanceVersus(delta) {
  if (!match) return
  // Online, the room is the clock. Everything here would be a second opinion
  // about a board this browser does not own.
  if (online()) return

  match.step(delta)
  // Bursts fade on their own clock, the way the single-player tweens do.
  for (const lane of laneFx) {
    if (lane.nearMissBurst < 1) lane.nearMissBurst = Math.min(1, lane.nearMissBurst + delta / 750)
  }
}

function versusView() {
  const isOnline = online()
  return {
    versus: match,
    race: match,
    theme,
    cell,
    foods,
    fatalities: FATALITIES,
    across: raceAcross,
    names: SEATS.map(seat => lobbyState?.players?.[seat]?.nick || ""),
    foodStyleIndex: game.foodStyleIndex,
    seat: isOnline ? versusSeat : null,
    // A lane draws with the single-player renderer, so it needs the two things
    // that renderer reads besides the game itself. Only this browser has any
    // music, and only for the seat it is sitting in: the far lane's party is
    // on, its board simply does not pulse to a beat this machine cannot hear.
    effectsFor: seat => laneFx[seat],
    musicFor: seat => laneMusic(
      match?.players?.[seat]?.party,
      isOnline ? (seat === versusSeat ? music : null) : music),
    lobbyNote,
    hint: isOnline
      ? versusSeat === null ? "watching" : "arrows or W A S D"
      : "P1 arrows   ·   P2 W A S D",
    rematchNote: isOnline && versusSeat === null
      ? "waiting for a rematch"
      : "Space for a rematch"
  }
}

// --- the two-player HUD ---

const pips = (wins, needed) => "●".repeat(wins) + "○".repeat(Math.max(0, needed - wins))

function updateVersusHud() {
  const middle = el("vs-middle")
  if (inLobby) middle.textContent = online() ? "LOBBY" : "READY?"
  else if (!match) middle.textContent = "…"
  else if (match.phase === PHASE_MATCH_OVER) middle.textContent = "MATCH OVER"
  else if (matchMode === "race") middle.textContent = `ROUND ${match.round} — TO ${levelName(setBossLevel(match.round))}`
  else middle.textContent = `ROUND ${match.round}`

  const players = match ? match.seated : []
  const board = el("vs-players")
  // One chip per seat that is playing, rebuilt only when their number changes.
  if (board.childElementCount !== players.length) {
    board.replaceChildren()
    for (const player of players) {
      const chip = document.createElement("div")
      chip.className = `vs-chip seat-${player.seat}`
      const name = document.createElement("span")
      name.className = "vs-name"
      const pips = document.createElement("span")
      pips.className = "vs-pips"
      const extra = document.createElement("span")
      extra.className = "vs-apples"
      chip.append(name, pips, extra)
      board.append(chip)
    }
  }
  players.forEach((player, index) => {
    const chip = board.children[index]
    if (!chip) return
    chip.className = `vs-chip seat-${player.seat}`
    chip.children[0].textContent = versusLabel(player.seat).toUpperCase().slice(0, 10)
    chip.children[1].textContent = pips(player.wins, match.winsNeeded)
    // A duel counts apples this round; a race counts the level reached, which
    // is the number its players are actually watching.
    chip.children[2].textContent = matchMode === "race"
      ? `${levelName(player.game.displayedLevel)}${player.party ? " 🎉" : ""}`
      : (player.score || "")
  })
}

// --- wiring ---

el("versus-hotseat").addEventListener("click", () => startHotseat())
el("versus-create").addEventListener("click", () => createRoom())
el("versus-close").addEventListener("click", () => closeVersusDialog())
el("versus-join").addEventListener("submit", event => {
  event.preventDefault()
  joinRoom(el("versus-code").value)
})

el("lobby-ready").addEventListener("click", () => pressReady())
el("lobby-leave").addEventListener("click", () => leaveTwoPlayer())

for (const button of el("lobby-modes").querySelectorAll(".mode")) {
  button.addEventListener("click", () => {
    const wanted = button.dataset.mode
    if (online()) net?.setMode(wanted)
    else matchMode = wanted
    renderLobby()
  })
}

el("chat-form").addEventListener("submit", event => {
  event.preventDefault()
  const input = el("chat-input")
  const text = input.value.trim()
  if (!text) return
  net?.chat(text)
  input.value = ""
})

// No `navigator.clipboard` outside a secure context, and this page is not
// allowed to assume one. Selecting the link is what every browser can do.
function copyLink(input, note) {
  input.select()
  try {
    navigator.clipboard?.writeText(input.value)
    if (note) {
      lobbyNote = "link copied"
      renderLobby()
    }
  } catch {
    // Then the link is selected, which is the fallback and always works.
  }
}

versusLink.addEventListener("focus", () => versusLink.select())
el("versus-copy").addEventListener("click", () => copyLink(versusLink, false))
el("lobby-link").addEventListener("focus", () => el("lobby-link").select())
el("lobby-copy").addEventListener("click", () => copyLink(el("lobby-link"), true))

// --- fullscreen --------------------------------------------------------------

// Fullscreening the stage lets the browser hide its siblings; nothing here
// hides the title and the blurb, they are simply outside the subtree drawn.
const stage = el("stage")

const fullscreenElement = () => document.fullscreenElement || document.webkitFullscreenElement || null
const isFullscreen = () => fullscreenElement() === stage || stage.classList.contains("faux")

// iOS Safari has no requestFullscreen at all, and a framed page may be refused,
// so the CSS version stands in rather than leaving a button that does nothing.
function setFaux(on) {
  stage.classList.toggle("faux", on)
  afterFullscreen()
}

function toggleFullscreen() {
  if (isFullscreen()) {
    const exit = document.exitFullscreen || document.webkitExitFullscreen
    if (fullscreenElement() && exit) exit.call(document)
    else setFaux(false)
    return
  }
  const request = stage.requestFullscreen || stage.webkitRequestFullscreen
  if (!request) return setFaux(true)
  let asked
  try {
    asked = request.call(stage)
  } catch {
    return setFaux(true)
  }
  asked?.catch?.(() => setFaux(true))
}

function afterFullscreen() {
  resize()
  updateHud()
}

document.addEventListener("fullscreenchange", afterFullscreen)
document.addEventListener("webkitfullscreenchange", afterFullscreen)

// Accepts ?full, ?full=1 and ?fullscreen; ?full=0, ?full=false and ?full=off
// are an explicit no, so the parameter can be templated in as a variable
// without the caller having to add and remove it. It can only ever reach the
// CSS half: the Fullscreen API refuses any request that did not come from a
// gesture, which a URL never is. For kiosks, second monitors and screenshots.
function fullParameter() {
  const query = new URLSearchParams(location.search)
  const value = query.has("full") ? query.get("full")
    : query.has("fullscreen") ? query.get("fullscreen")
    : null
  if (value === null) return false
  return value !== "0" && value !== "false" && value !== "off"
}

function cycleTheme() {
  theme = resolve(nextTheme(theme))
  store.setItem("omasnake/appearance/theme", theme.id)
  applyTheme()
}

function applyTheme() {
  const root = document.documentElement
  root.style.setProperty("--bg", theme.background)
  root.style.setProperty("--fg", theme.foreground)
  root.style.setProperty("--accent", theme.accent)
  root.style.setProperty("--muted", theme.muted)
  root.style.setProperty("--selection", theme.selection)
  root.style.setProperty("--play-area", theme.playArea)
  root.style.setProperty("--trough", rgba(darker(theme.colors.background, 1.35)))
  root.style.setProperty("--combo-trough", rgba(mixColors(theme.colors.background, theme.colors.muted, 0.55)))
  root.style.setProperty("--button-hover", rgba(mixColors(theme.colors.accent, theme.colors.foreground, 0.14)))
  root.style.setProperty("--button-active", rgba(mixColors(theme.colors.accent, theme.colors.background, 0.16)))
  root.style.setProperty("--button-border", rgba(mixColors(theme.colors.accent, theme.colors.foreground, 0.32)))
  root.style.colorScheme = theme.dark ? "dark" : "light"
  // The face previews are drawn, not styled, so a new palette has to redraw
  // them. Nothing else does.
  paintHeads()
  renderLobby()
  updateHud()
}

// --- HUD ---------------------------------------------------------------------

const timeText = seconds => {
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return `${minutes < 10 ? "0" : ""}${minutes}:${rest < 10 ? "0" : ""}${rest}`
}

function updateHud() {
  if (twoPlayer()) {
    updateVersusHud()
    updateButtons()
    return
  }
  el("level").textContent = game.endlessMode
    ? "ENDLESS"
    : game.bossLevel ? bossFor(bossNumber(game.displayedLevel)).name : `LEVEL ${levelName(game.level)}`
  el("score").textContent = `SCORE ${game.score}${game.best ? `  ·  BEST ${game.best}` : ""}`

  document.body.classList.toggle("party", music.enabled)
  el("level-progress").hidden = game.endlessMode
  // On a boss level the bar stops being progress and becomes the boss.
  el("level-progress-fill").style.width = `${(game.bossLevel ? game.bossHealth : game.levelProgress) * 100}%`
  el("level-progress").classList.toggle("boss", game.bossLevel)
  el("combo").hidden = !music.enabled
  el("combo-fill").style.width = `${game.comboProgress * 100}%`
  el("combo-name").hidden = !music.enabled
  el("combo-name").textContent = `${partyComboName(game.foodMultiplier)}  ×${game.foodMultiplier}`
  el("elapsed").hidden = !(game.endlessMode && !music.enabled)
  el("elapsed").textContent = timeText(game.elapsedSeconds)

  updateButtons()
}

function updateButtons() {
  for (const button of buttons) {
    const node = el(button.id)
    // The shortcut is shown by bolding the letter, not by trailing "(x)".
    node.innerHTML = `<b>${button.letter}</b>${escapeHtml(button.rest())}`
    node.setAttribute("aria-label", button.name())
    node.style.fontFamily = button.family ? button.family() : ""
  }
}

const escapeHtml = text => text.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c])

let announced = ""
function announce(text) {
  if (text === announced) return
  announced = text
  status.textContent = text
}

// --- layout ------------------------------------------------------------------

let cell = 20

function resize() {
  // The frame is a flex child that already holds exactly the room the rest of
  // the column left over, and the canvas inside it is absolutely positioned,
  // so measuring the frame asks the layout what is left instead of adding up
  // siblings. Fullscreen needs no special case for the same reason.
  const frame = el("board-frame")
  // A big monitor does not want a board the size of a wall — 40 keeps it
  // inside the 900px column the rest of the page lives in. A screen given over
  // entirely to the game may as well use it.
  const largest = isFullscreen() ? 64 : 40

  // Only the head and the meters follow --board-w, and neither changes height
  // with width, so one pass is normally the answer. The second is there for
  // the case where a long track name wraps the header.
  // Three shapes of board can be on screen: a single-player one, a duel's
  // wider one, and a race's two of the single-player size. It is whichever is
  // there that has to fit the frame.
  const racing = match && matchMode === "race"
  const columns = racing ? RACE_COLUMNS : match ? match.columns : COLUMNS
  const rows = racing ? RACE_ROWS : match ? match.rows : ROWS
  // A duel's board is six rows taller, and a race has two boards, so on a
  // short window the floor that keeps a single-player board readable is the
  // thing that pushes them out through the controls. Better a small board than
  // a board with a button across it.
  const floor = match ? 8 : 12

  let previous = -1
  for (let pass = 0; pass < 2 && cell !== previous; ++pass) {
    previous = cell
    // Whole pixels per cell, so a 22-wide board never lands on a half pixel
    // and draws the snake one shade blurry.
    let byWidth = Math.floor(frame.clientWidth / columns)
    let byHeight = Math.floor(frame.clientHeight / rows)

    if (racing) {
      // Two to four boards with a gap of a cell between them. Every way of
      // splitting them across rows is tried and the roomiest wins, which on a
      // phone held upright is one board per row rather than four squints.
      const fit = raceFit(match.seated.length, frame.clientWidth, frame.clientHeight, columns, rows)
      raceAcross = fit.across
      byWidth = fit.cell
      byHeight = fit.cell
    }

    cell = Math.max(floor, Math.min(largest, Math.min(byWidth, byHeight)))
    const wide = racing
      ? raceLayout(cell, columns, rows, raceAcross, match.seated.length).width
      : columns * cell
    document.documentElement.style.setProperty("--board-w", `${wide}px`)
  }

  const { width, height } = racing
    ? raceLayout(cell, columns, rows, raceAcross, match.seated.length)
    : boardSize(cell, columns, rows)
  const ratio = Math.min(3, devicePixelRatio || 1)
  canvas.width = Math.round(width * ratio)
  canvas.height = Math.round(height * ratio)
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)

  splashCanvas.width = Math.round(innerWidth * ratio)
  splashCanvas.height = Math.round(innerHeight * ratio)
  splashCanvas.style.width = `${innerWidth}px`
  splashCanvas.style.height = `${innerHeight}px`
  splashCtx.setTransform(ratio, 0, 0, ratio, 0, 0)
}

addEventListener("resize", resize)

// --- the loop ----------------------------------------------------------------

let lastFrame = performance.now()
let tickAccumulator = 0
let clockAccumulator = 0
let comboAccumulator = 0
let saveAccumulator = 0

function frame(now) {
  // A backgrounded tab returns with a huge delta. Cap it so the snake does not
  // teleport into a wall the moment someone comes back.
  const delta = Math.min(120, now - lastFrame)
  lastFrame = now

  for (const tween of tweens) tween.update(now)

  // A duel borrows the page, the theme and the soundtrack, and none of the
  // single-player machinery below — no bosses, no level fades, no party
  // events, and nothing that could reach a best score or the charts.
  if (twoPlayer()) {
    music.update(delta, now)
    // The lobby is DOM, so there is nothing to paint while it is up — and the
    // canvas is hidden underneath it rather than drawn over.
    if (match) {
      advanceVersus(delta)
      if (matchMode === "race") drawRace(ctx, versusView())
      else drawVersus(ctx, versusView())
    }
    updateHud()
    requestAnimationFrame(frame)
    return
  }

  // The finish window and the finish itself run on their own clock, which
  // keeps going while everything on the board is deliberately frozen.
  game.advanceBoss(delta)

  // A boss track belongs to a boss level. Winning, dying, restarting or
  // jumping away all leave one, and all of them sound the same from here.
  if (music.inBossTrack && (!game.bossLevel || game.gameOver)) leaveBossMusic()

  // A track too slow or too quiet to produce a strong beat must not leave the
  // level-clear screen up forever.
  if (waitingForLevelBeat && now - beatWaitStarted > LEVEL_BEAT_WAIT_MS) startNextLevel()

  if (musicPauseDelay > 0) {
    musicPauseDelay -= delta
    if (musicPauseDelay <= 0) music.setGameActive(false)
  }

  const active = game.running && !game.gameOver && !game.levelTransition
  if (active) {
    tickAccumulator += delta
    const interval = game.tickInterval
    while (tickAccumulator >= interval) {
      tickAccumulator -= interval
      game.tick()
    }
    clockAccumulator += delta
    while (clockAccumulator >= 1000) {
      clockAccumulator -= 1000
      game.advanceClock()
    }
    if (music.enabled) {
      comboAccumulator += delta
      while (comboAccumulator >= 50) {
        comboAccumulator -= 50
        game.advanceCombo(50)
      }
    }
  } else {
    tickAccumulator = 0
    clockAccumulator = 0
    comboAccumulator = 0
  }

  // Lifetime playtime and best scores are worth keeping without writing to
  // storage sixty times a second.
  saveAccumulator += delta
  if (saveAccumulator >= 5000) {
    saveAccumulator = 0
    game.saveSettings()
  }

  music.update(delta, now)

  if (music.enabled) {
    const cutoff = Date.now() - 2500
    if (fx.danceHistory.length && fx.danceHistory[0].time < cutoff)
      fx.danceHistory = fx.danceHistory.filter(wave => wave.time >= cutoff)
  }
  // Two half-second halves of one InOutSine ping-pong, evaluated rather than
  // animated because it never stops while the disco ball is on the board.
  fx.discoPulse = music.enabled ? 0 : (1 - Math.cos((Math.PI * (now % 840)) / 420)) / 2

  draw(ctx, {
    game, music, theme, fx, cell, foods, levelMessage, gameOverMessage,
    bossNumber: bossNumber(game.displayedLevel),
    fatalities: FATALITIES,
    finisherInputs: game.finisherInputs,
    fatalityName: game.fatality?.name || "",
    fatalityFlavour: game.fatality?.flavour || "",
    fatalityId: game.fatality?.id || "mercy",
    fatalityProgress: game.fatalityProgress
  })
  if (fx.partySplashOpacity > 0) {
    splashCanvas.hidden = false
    const splashView = {
      theme, fx, width: innerWidth, height: innerHeight,
      trackName: music.trackName,
      bossNumber: bossNumber(game.displayedLevel)
    }
    if (fx.splashKind === "boss") drawBossSplash(splashCtx, splashView)
    else drawSplash(splashCtx, splashView)
  } else if (!splashCanvas.hidden) {
    splashCanvas.hidden = true
  }

  updateHud()
  requestAnimationFrame(frame)
}

// --- start -------------------------------------------------------------------

// A tab going away should not keep playing to nobody.
addEventListener("visibilitychange", () => {
  if (!document.hidden) return
  game.saveSettings()
  // A duel is not paused by looking away. Online there is somebody else still
  // playing it, and at one keyboard the other player may well be the one
  // looking at the screen.
  if (!twoPlayer() && game.running && !game.gameOver) game.togglePause()
})

// The model's own constructor resets before anything is listening, so the
// first run of the page needs its token asking for by hand.
charts.startRun()

// ?level=3.2 drops straight onto a level, on the same development-only terms.
if (debugKeys) {
  const wanted = new URLSearchParams(location.search).get("level")
  if (wanted) jumpTo(wanted)
}

// ?room=code is the invitation the other player was sent. Unlike ?level= this
// is not a development-only door: it reaches a duel, and a duel cannot reach a
// best score or the charts by design.
const invited = new URLSearchParams(location.search).get("room")

applyTheme()
if (fullParameter()) setFaux(true)
resize()
loadSymbols().then(resize)
requestAnimationFrame(now => {
  lastFrame = now
  frame(now)
})

if (invited) joinRoom(invited)

// Handy from the console, and how the screenshot tool drives the page.
globalThis.omasnake = { game, music, fx, charts, themes, jumpTo,
  match: () => match, mode: () => matchMode, startHotseat, joinRoom,
  leaveTwoPlayer, setTheme: id => {
  const found = themes.find(candidate => candidate.id === id)
  if (!found) return false
  theme = resolve(found)
  store.setItem("omasnake/appearance/theme", theme.id)
  applyTheme()
  return true
} }
