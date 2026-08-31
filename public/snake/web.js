// Browser wiring: input, timers, animation values, the HUD and the render loop.
//
// This is the QML file's other half — everything `src/Main.qml` does that is
// not drawing. The animation constants, easing curves and the order effects
// fire in are all from there, because they are what the game feels like.

import { COLUMNS, ROWS, Game, bossNumber, levelFromName, levelName, nextBossLevel } from "./Game.js"
import { MusicController } from "./Audio.js"
import { draw, drawBossSplash, drawHeadPreview, drawSplash, drawVersus, boardSize, versusName } from "./Draw.js"
import { Net, newRoomCode, roomLink, validCode } from "./Net.js"
import {
  HEADS,
  PHASE_LOBBY,
  PHASE_MATCH_OVER,
  PHASE_PLAYING,
  PHASE_ROUND_OVER,
  Versus,
  validHead
} from "./Versus.js"
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
  if (!game.levelTransition) {
    musicPauseDelay = 0
    musicFade.stop()
    if (game.running && !game.gameOver) {
      music.setGameActive(true)
      musicFade.restart({ from: music.volume, to: 0.55 })
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
  game.registerStrongBeat(strength)
  if (waitingForLevelBeat) startNextLevel()
  fx.recordDanceBeat(strength)
  backgroundFlash.restart({ from: 0.07 + strength * 0.08, to: 0 })
})

music.on("onset", () => foodBeatIn.restart())

music.on("enabledChanged", () => {
  game.setPartyMode(music.enabled)
  if (music.enabled) {
    startSplash("party")
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
  if (versus) {
    if (versusKey(event.key)) event.preventDefault()
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
  if (versus) {
    endVersus()
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
  if (versus) {
    if (Math.abs(dx) > Math.abs(dy)) steerVersus(touchSeat(), Math.sign(dx), 0)
    else steerVersus(touchSeat(), 0, Math.sign(dy))
  } else if (Math.abs(dx) > Math.abs(dy)) game.turn(Math.sign(dx), 0)
  else game.turn(0, Math.sign(dy))
  touch = { x: event.clientX, y: event.clientY, steered: true }
})
canvas.addEventListener("pointerup", () => {
  // A phone has no key to press, so a tap is how it gets on with it there.
  if (touch && !touch.steered) {
    if (versus) versusSpace()
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
  { id: "versus", letter: "2", rest: () => (versus ? " Players: Leave" : " Players"),
    name: () => (versus ? "Leave the duel" : "Two players, here or online"),
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

// A duel is a different model on a different board, so while one is up the
// single-player game is simply not running: nothing ticks it, nothing draws
// it, and nothing it did not do can reach its best score or the charts.
let versus = null
// "hotseat" or "online". The difference is who ticks the board and how many
// snakes this keyboard is steering.
let versusKind = null
let versusSeat = null
let versusNote = ""
let net = null
let versusAccumulator = 0

const versusDialog = el("versus-dialog")
const versusNoteText = el("versus-note")
const versusShare = el("versus-share")
const versusLink = el("versus-link")

// --- picking a head ---

// Which face each seat wears. Kept per seat rather than per player because
// that is the only handle there is: online you take the seat you are given,
// and with it that seat's face.
const headKey = seat => `omasnake/versus/head${seat}`
const versusHeads = [0, 1].map(seat => {
  const stored = store.getItem(headKey(seat))
  return stored === null ? (seat === 0 ? 0 : 3) : validHead(stored)
})

const HEAD_PREVIEW = 30
const headsBox = el("versus-heads")
const headOptions = [[], []]

function buildHeadPickers() {
  for (const seat of [0, 1]) {
    const row = document.createElement("div")
    row.className = "heads-row"

    const label = document.createElement("span")
    label.className = "heads-label"
    label.textContent = `P${seat + 1}`

    const options = document.createElement("div")
    options.className = "heads-options"

    HEADS.forEach((style, index) => {
      const button = document.createElement("button")
      button.type = "button"
      button.className = "head"
      // A canvas has nothing for a screen reader to read, so the name the
      // roster carries is what the button is called.
      button.setAttribute("aria-label", `Player ${seat + 1}: ${style.name}`)
      const canvas = document.createElement("canvas")
      button.append(canvas)
      button.addEventListener("click", () => chooseHead(seat, index))
      options.append(button)
      headOptions[seat].push({ button, canvas, index })
    })

    row.append(label, options)
    headsBox.append(row)
  }
}

function paintHeadPickers() {
  const ratio = Math.min(3, devicePixelRatio || 1)
  for (const seat of [0, 1]) {
    for (const { button, canvas, index } of headOptions[seat]) {
      canvas.width = Math.round(HEAD_PREVIEW * ratio)
      canvas.height = Math.round(HEAD_PREVIEW * ratio)
      canvas.style.width = `${HEAD_PREVIEW}px`
      canvas.style.height = `${HEAD_PREVIEW}px`
      const context = canvas.getContext("2d")
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      drawHeadPreview(context, { theme, seat, head: index, size: HEAD_PREVIEW })
      button.setAttribute("aria-pressed", String(versusHeads[seat] === index))
    }
  }
}

function chooseHead(seat, index) {
  versusHeads[seat] = validHead(index)
  try {
    store.setItem(headKey(seat), versusHeads[seat])
  } catch {
    // A locked-down origin costs somebody their face next time, and nothing
    // else. Not worth losing the choice they just made over.
  }
  paintHeadPickers()
  applyChosenHeads()
}

// Online this browser only ever speaks for its own seat; the room tells both
// of us what the other picked.
function applyChosenHeads() {
  if (!versus) return
  if (versusKind === "online") {
    if (versusSeat !== null) net?.setHead(versusHeads[versusSeat])
    return
  }
  for (const seat of [0, 1]) versus.setHead(seat, versusHeads[seat])
}

buildHeadPickers()

function openVersus() {
  if (versus) {
    endVersus()
    return
  }
  versusShare.hidden = true
  versusNoteText.textContent = ""
  paintHeadPickers()
  if (!versusDialog.open) versusDialog.showModal()
}

function closeVersusDialog() {
  if (versusDialog.open) versusDialog.close()
}

function startVersus(kind) {
  // Whatever the single-player run was doing, it is not doing it now. Saving
  // first means a run interrupted by a duel keeps its lifetime playtime.
  if (game.running && !game.gameOver) game.togglePause()
  game.saveSettings()

  versusKind = kind
  versusSeat = null
  versusAccumulator = 0
  versus = new Versus({ wrap: game.wallsWrap })
  versus.on("roundOver", winner => announceRound(winner))
  versus.on("matchOver", winner => announce(`${versusLabel(winner)} wins the match.`))
  document.body.classList.add("versus")
  closeVersusDialog()
  resize()
  updateHud()
}

function endVersus() {
  if (net) {
    net.close()
    net = null
  }
  versus = null
  versusKind = null
  versusSeat = null
  versusNote = ""
  document.body.classList.remove("versus")
  resize()
  updateHud()
  announce("Back to one player.")
}

function startHotseat() {
  startVersus("hotseat")
  versus.startMatch()
  applyChosenHeads()
  announce("Two players. Player one steers with the arrows, player two with W A S D.")
}

function joinRoom(code) {
  const wanted = String(code || "").trim().toLowerCase()
  if (!validCode(wanted)) {
    versusNoteText.textContent = "A room code is 4 to 12 letters or digits."
    return
  }
  startVersus("online")
  versusNote = "connecting…"
  net = new Net({
    onWelcome: message => {
      versusSeat = message.seat
      // The room decides which seat this is, so which face to ask for is only
      // knowable once it has said.
      applyChosenHeads()
      updateHud()
    },
    onSeats: message => {
      const waiting = message.taken.filter(Boolean).length < 2
      versusNote = waiting
        ? `share the code — ${net.code.toUpperCase()}`
        : versusSeat === null ? "both seats taken — watching" : ""
      updateHud()
    },
    onState: state => {
      if (state) versus.applySnapshot(state)
      // A room with no match in it has nothing to pour in, and the board it
      // last showed belonged to a match that has been abandoned.
      else versus.toLobby()
      updateHud()
    },
    onLeft: seat => {
      versusNote = `${versusLabel(seat)} left — waiting for somebody else`
      announce(versusNote)
      updateHud()
    },
    onStatus: status => {
      if (status === "connecting") versusNote = "connecting…"
      else if (status === "failed") versusNote = "could not reach the room"
      else if (status === "dropped") versusNote = "connection lost — rejoin from 2 Players"
      updateHud()
    }
  })
  net.connect(wanted, { wrap: game.wallsWrap })
}

function createRoom() {
  const code = newRoomCode()
  versusShare.hidden = false
  versusLink.value = roomLink(code)
  versusNoteText.textContent = `Room ${code.toUpperCase()}. Send the link, and the first person to open it takes the other seat.`
  joinRoom(code)
}

// Who a seat is, said the way this browser should say it: two people at one
// keyboard are player one and player two, and two people in two rooms are you
// and them.
const versusLabel = seat =>
  versusKind === "online" ? (seat === versusSeat ? "You" : "They") : `Player ${seat + 1}`

function announceRound(winner) {
  if (!versus) return
  announce(winner === -1
    ? `Round ${versus.round}: nobody takes it.`
    : `Round ${versus.round} to ${versusLabel(winner)}.`)
}

// --- steering a duel ---

// Arrows and vi keys are the first seat's; W A S D is the second's. Online
// there is only one snake to steer and both sets steer it, because insisting
// on one of them would be a rule with nothing behind it.
const VERSUS_FIRST = new Map([
  ["ArrowLeft", [-1, 0]], ["ArrowRight", [1, 0]], ["ArrowUp", [0, -1]], ["ArrowDown", [0, 1]],
  ["h", [-1, 0]], ["l", [1, 0]], ["k", [0, -1]], ["j", [0, 1]]
])
const VERSUS_SECOND = new Map([
  ["a", [-1, 0]], ["d", [1, 0]], ["w", [0, -1]], ["s", [0, 1]]
])

// Which snake a drag on the board steers. Online it is the one this browser
// has; at one keyboard a phone has only one pair of thumbs, so it is the first.
const touchSeat = () => (versusKind === "online" ? versusSeat : 0)

function steerVersus(seat, dx, dy) {
  if (seat === null || seat === undefined || !versus) return
  if (versusKind === "online") {
    // The room decides whether the turn is legal, and the room's copy of the
    // board is the one that counts. Turning the local one as well would only
    // be a guess that the next frame contradicts.
    net?.turn(dx, dy)
    return
  }
  versus.turn(seat, dx, dy)
}

// Space starts the next match. It is the same key that restarts a single-player
// run, which is the whole reason it is that key.
function versusSpace() {
  if (!versus) return
  if (versus.phase !== PHASE_MATCH_OVER) return
  if (versusKind === "online") net?.rematch()
  else versus.startMatch()
}

function versusKey(key) {
  const lower = key.length === 1 ? key.toLowerCase() : key
  const first = VERSUS_FIRST.get(lower)
  if (first) {
    steerVersus(versusKind === "online" ? versusSeat : 0, first[0], first[1])
    return true
  }
  const second = VERSUS_SECOND.get(lower)
  if (second) {
    steerVersus(versusKind === "online" ? versusSeat : 1, second[0], second[1])
    return true
  }
  if (key === " ") {
    versusSpace()
    return true
  }
  if (key === "Escape") {
    pauseIfRunning()
    return true
  }
  // The two switches that are about this screen rather than about the match.
  switch (lower) {
    case "t": cycleTheme(); return true
    case "v": toggleFullscreen(); return true
    case "2": endVersus(); return true
    default: return false
  }
}

// --- the duel's own frame ---

function advanceVersus(delta) {
  if (!versus) return
  // Online, the room is the clock. Everything here would be a second opinion
  // about a board this browser does not own.
  if (versusKind === "online") return

  versus.advance(delta)
  if (versus.phase !== PHASE_PLAYING) {
    versusAccumulator = 0
    return
  }
  versusAccumulator += delta
  let steps = 0
  while (versusAccumulator >= versus.tickInterval && versus.phase === PHASE_PLAYING && steps++ < 5) {
    versusAccumulator -= versus.tickInterval
    versus.tick()
  }
}

function versusView() {
  const online = versusKind === "online"
  return {
    versus,
    theme,
    cell,
    foods,
    foodStyleIndex: game.foodStyleIndex,
    seat: online ? versusSeat : null,
    lobbyNote: versusNote || (online ? "for a second player" : ""),
    hint: online
      ? versusSeat === null ? "watching" : "arrows or W A S D"
      : "P1 arrows   ·   P2 W A S D",
    rematchNote: online && versusSeat === null
      ? "waiting for a rematch"
      : "Space for a rematch"
  }
}

// --- the duel's HUD ---

const pips = (wins, needed) => "●".repeat(wins) + "○".repeat(Math.max(0, needed - wins))

function updateVersusHud() {
  const middle = el("vs-middle")
  if (versus.phase === PHASE_LOBBY) middle.textContent = versusKind === "online" ? "WAITING" : "READY"
  else if (versus.phase === PHASE_MATCH_OVER) middle.textContent = "MATCH OVER"
  else middle.textContent = `ROUND ${versus.round}`

  for (const seat of [0, 1]) {
    const player = versus.players[seat]
    el(`vs-name-${seat}`).textContent = versusKind === "online"
      ? versusName(seat, versusSeat)
      : `P${seat + 1}`
    el(`vs-pips-${seat}`).textContent = pips(player.wins, versus.winsNeeded)
    el(`vs-apples-${seat}`).textContent = player.score ? `${player.score}` : ""
  }
}

el("versus-hotseat").addEventListener("click", () => startHotseat())
el("versus-create").addEventListener("click", () => createRoom())
el("versus-close").addEventListener("click", () => closeVersusDialog())
el("versus-join").addEventListener("submit", event => {
  event.preventDefault()
  joinRoom(el("versus-code").value)
})
// No `navigator.clipboard` outside a secure context, and this page is not
// allowed to assume one. Selecting the link is what every browser can do.
versusLink.addEventListener("focus", () => versusLink.select())
el("versus-copy").addEventListener("click", () => {
  versusLink.select()
  try {
    navigator.clipboard?.writeText(versusLink.value)
  } catch {
    // Then the link is selected, which is the fallback and always works.
  }
})

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
  // The previews are drawn, not styled, so a new palette has to redraw them.
  paintHeadPickers()
  updateHud()
}

// --- HUD ---------------------------------------------------------------------

const timeText = seconds => {
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return `${minutes < 10 ? "0" : ""}${minutes}:${rest < 10 ? "0" : ""}${rest}`
}

function updateHud() {
  if (versus) {
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
  // A duel is played on a wider board than a run is, and it is the board on
  // screen that has to fit the frame.
  const columns = versus ? versus.columns : COLUMNS
  const rows = versus ? versus.rows : ROWS

  let previous = -1
  for (let pass = 0; pass < 2 && cell !== previous; ++pass) {
    previous = cell
    // Whole pixels per cell, so a 22-wide board never lands on a half pixel
    // and draws the snake one shade blurry.
    const byWidth = Math.floor(frame.clientWidth / columns)
    const byHeight = Math.floor(frame.clientHeight / rows)
    // A duel's board is six rows taller, so on a short window the floor that
    // keeps a single-player board readable is the thing that pushes a versus
    // one out through the controls. Better a small board than a board with a
    // button across it.
    cell = Math.max(versus ? 8 : 12, Math.min(largest, Math.min(byWidth, byHeight)))
    document.documentElement.style.setProperty("--board-w", `${columns * cell}px`)
  }

  const { width, height } = boardSize(cell, columns, rows)
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
  if (versus) {
    music.update(delta, now)
    advanceVersus(delta)
    drawVersus(ctx, versusView())
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
  if (!versus && game.running && !game.gameOver) game.togglePause()
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
  versus: () => versus, startHotseat, joinRoom, endVersus, setTheme: id => {
  const found = themes.find(candidate => candidate.id === id)
  if (!found) return false
  theme = resolve(found)
  store.setItem("omasnake/appearance/theme", theme.id)
  applyTheme()
  return true
} }
