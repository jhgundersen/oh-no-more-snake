// Browser wiring: input, timers, animation values, the HUD and the render loop.
//
// This is the QML file's other half — everything `src/Main.qml` does that is
// not drawing. The animation constants, easing curves and the order effects
// fire in are all from there, because they are what the game feels like.

import { COLUMNS, ROWS, Game } from "./Game.js"
import { MusicController } from "./Audio.js"
import { draw, drawSplash, boardSize } from "./Draw.js"
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
let levelTransitionStarted = 0
let beatWaitStarted = 0

// A slow track — or a quiet passage in a loud one — can leave the level-clear
// screen waiting for a strong beat that is not coming. Two escapes: the wait
// gives up on its own, and after a second anybody can press their way out.
const LEVEL_BEAT_WAIT_MS = 2500
const LEVEL_SKIP_AFTER_MS = 1000

// Fruit plus the original plugin's Apple, GitHub, OpenAI and Linux Nerd Font
// glyphs. The private-use glyphs need that exact family, and a browser without
// it would draw four identical boxes — so they join the cycle only once the
// font has answered for itself.
const NERD_FAMILY = '"JetBrainsMono Nerd Font", "JetBrainsMono NF", monospace'
const allFoods = [
  { glyph: "🍎", family: "sans-serif" },
  { glyph: "🍇", family: "sans-serif" },
  { glyph: "🍓", family: "sans-serif" },
  { glyph: "🍒", family: "sans-serif" },
  { glyph: "🍉", family: "sans-serif" },
  { glyph: "\u{f0035}", family: NERD_FAMILY, nerd: true },
  { glyph: "\u{f02a4}", family: NERD_FAMILY, nerd: true },
  { glyph: "\u{f0868}", family: NERD_FAMILY, nerd: true },
  { glyph: "\u{f17c}", family: NERD_FAMILY, nerd: true }
]
let foods = allFoods.filter(food => !food.nerd)

async function detectNerdFont() {
  try {
    await document.fonts.ready
    if (document.fonts.check('16px "JetBrainsMono Nerd Font"')) foods = allFoods
  } catch {
    // Leaving the five fruit in place is the safe answer.
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

function startPartySplash() {
  fx.partySplashOpacity = 0
  fx.partySplashScale = 0.78
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

const musicFade = register(new Tween({
  from: 0, to: 0, duration: 650, curve: easing.inOutSine,
  apply: v => music.setVolume(v)
}))
let musicPauseDelay = 0

// --- game events -------------------------------------------------------------

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
    gameOverMessage = pickDifferent(gameOverMessages, gameOverMessage)
    gameOverMessageChosen = true
    announce(`Game over. Score ${game.score}. ${gameOverMessage}`)
    if (game.score > 0) {
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
    startPartySplash()
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
  // With the charts up, the board is not the thing being looked at. Escape is
  // left to the dialog, which closes on it by itself.
  if (chartsDialog.open) {
    if (event.key.toLowerCase() === "c") {
      closeCharts()
      event.preventDefault()
    }
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
  if (Math.abs(dx) > Math.abs(dy)) game.turn(Math.sign(dx), 0)
  else game.turn(0, Math.sign(dy))
  touch = { x: event.clientX, y: event.clientY, steered: true }
})
canvas.addEventListener("pointerup", () => {
  // A phone has no key to press, so a tap is how it gets on with it there.
  if (touch && !touch.steered && !skipLevelTransition()) {
    game.cycleFoodStyle(foods.length)
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
    name: () => "Charts, the highest scores", act: () => openCharts() }
]

for (const button of buttons) {
  el(button.id).addEventListener("click", () => {
    button.act()
    updateHud()
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
  updateHud()
}

// --- HUD ---------------------------------------------------------------------

const timeText = seconds => {
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return `${minutes < 10 ? "0" : ""}${minutes}:${rest < 10 ? "0" : ""}${rest}`
}

function updateHud() {
  el("level").textContent = game.endlessMode ? "ENDLESS" : `LEVEL ${game.level}`
  el("score").textContent = `SCORE ${game.score}${game.best ? `  ·  BEST ${game.best}` : ""}`

  document.body.classList.toggle("party", music.enabled)
  el("level-progress").hidden = game.endlessMode
  el("level-progress-fill").style.width = `${game.levelProgress * 100}%`
  el("combo").hidden = !music.enabled
  el("combo-fill").style.width = `${game.comboProgress * 100}%`
  el("combo-name").hidden = !music.enabled
  el("combo-name").textContent = `${partyComboName(game.foodMultiplier)}  ×${game.foodMultiplier}`
  el("elapsed").hidden = !(game.endlessMode && !music.enabled)
  el("elapsed").textContent = timeText(game.elapsedSeconds)

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
  let previous = -1
  for (let pass = 0; pass < 2 && cell !== previous; ++pass) {
    previous = cell
    // Whole pixels per cell, so a 22-wide board never lands on a half pixel
    // and draws the snake one shade blurry.
    const byWidth = Math.floor(frame.clientWidth / COLUMNS)
    const byHeight = Math.floor(frame.clientHeight / ROWS)
    cell = Math.max(12, Math.min(largest, Math.min(byWidth, byHeight)))
    document.documentElement.style.setProperty("--board-w", `${COLUMNS * cell}px`)
  }

  const { width, height } = boardSize(cell)
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

  draw(ctx, { game, music, theme, fx, cell, foods, levelMessage, gameOverMessage })
  if (fx.partySplashOpacity > 0) {
    splashCanvas.hidden = false
    drawSplash(splashCtx, { theme, fx, width: innerWidth, height: innerHeight, trackName: music.trackName })
  } else if (!splashCanvas.hidden) {
    splashCanvas.hidden = true
  }

  updateHud()
  requestAnimationFrame(frame)
}

// --- start -------------------------------------------------------------------

// A tab going away should not keep playing to nobody.
addEventListener("visibilitychange", () => {
  if (document.hidden) {
    game.saveSettings()
    if (game.running && !game.gameOver) game.togglePause()
  }
})

applyTheme()
if (fullParameter()) setFaux(true)
resize()
detectNerdFont().then(resize)
requestAnimationFrame(now => {
  lastFrame = now
  frame(now)
})

// Handy from the console, and how the screenshot tool drives the page.
globalThis.omasnake = { game, music, fx, themes, setTheme: id => {
  const found = themes.find(candidate => candidate.id === id)
  if (!found) return false
  theme = resolve(found)
  store.setItem("omasnake/appearance/theme", theme.id)
  applyTheme()
  return true
} }
