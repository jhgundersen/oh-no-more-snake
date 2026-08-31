// The board, drawn — a port of the Qt Quick scene in `src/Main.qml`.
//
// Only the board is canvas. Scores, meters and buttons stay real DOM elements
// so they keep their text, focus rings and accessible names, exactly as the
// Qt version keeps them as real controls rather than painted rectangles.
//
// Everything here reads state and draws it. Timers, input and animation values
// belong to web.js; game rules belong to Game.js.

import { COLUMNS, ROWS, levelName } from "./Game.js"
import { HEADS } from "./Versus.js"
import { spectrumRange } from "./Audio.js"
import { bossFor, drawPortrait } from "./Bosses.js"
import { mixColors, parseColor, rgba } from "./Palette.js"

// The boss palette is plain hex from Bosses.js, not the parsed theme colours.
const hexCache = new Map()
const parseHex = value => {
  let parsed = hexCache.get(value)
  if (!parsed) {
    parsed = parseColor(value)
    hexCache.set(value, parsed)
  }
  return parsed
}

const roundRect = (ctx, x, y, width, height, radius) => {
  ctx.beginPath()
  ctx.roundRect(x, y, width, height, radius)
}

const fillRound = (ctx, x, y, width, height, radius, style) => {
  roundRect(ctx, x, y, width, height, radius)
  ctx.fillStyle = style
  ctx.fill()
}

// The ink a face is drawn in. Near-black and white rather than theme colours,
// because a face has to read on top of whichever colour the head itself is,
// and in ten palettes that is every colour there is.
const INK = "#101014"
const GLINT = "#ffffff"
const ANGRY = "#ff4d4d"

// Eyes, facing the way the thing is going. They are the fastest way to tell at
// a glance which end of something is the end that matters — and in a duel,
// whose end it is.
//
// `angry` is the boss's face and stays a flag of its own rather than becoming
// head number three: a boss is not picking a look, it has one.
function drawFace(ctx, { x, y, size, direction, angry, head = 0 }) {
  const forward = direction && (direction.x || direction.y) ? direction : { x: 1, y: 0 }
  // Across the direction of travel, so the pair always sits side by side and
  // the head reads as a head whichever way it is going.
  const across = { x: -forward.y, y: forward.x }
  // Set back a little from the leading edge, so the brows have somewhere to
  // sit without running off the front of the head.
  const centreX = x + size / 2 + forward.x * size * 0.06
  const centreY = y + size / 2 + forward.y * size * 0.06
  const spread = size * 0.22
  const dot = size * 0.14

  // Everything below is laid out in the head's own frame — how far forward,
  // how far to the side — so one description of a face works in all four
  // directions of travel without a single special case.
  const at = (ahead, aside) => ({
    x: centreX + forward.x * ahead + across.x * aside,
    y: centreY + forward.y * ahead + across.y * aside
  })
  const spin = Math.atan2(forward.y, forward.x)
  const kind = angry ? "fierce" : (HEADS[head] || HEADS[0]).id

  if (kind === "visor") {
    // One band across the face, with a bright slit in it. The only head with
    // no pair of eyes at all, which is what makes it unmistakable.
    const length = (spread + dot) * 2
    const thickness = dot * 1.5
    ctx.save()
    ctx.translate(centreX, centreY)
    ctx.rotate(spin)
    fillRound(ctx, -thickness / 2, -length / 2, thickness, length, thickness / 2, INK)
    ctx.fillStyle = ANGRY
    ctx.fillRect(-thickness * 0.12, -length * 0.34, thickness * 0.24, length * 0.68)
    ctx.restore()
    return
  }

  if (kind === "cyclops") {
    const eye = at(0, 0)
    ctx.beginPath()
    ctx.arc(eye.x, eye.y, dot * 1.6, 0, Math.PI * 2)
    ctx.fillStyle = GLINT
    ctx.fill()
    ctx.beginPath()
    ctx.arc(eye.x, eye.y, dot * 0.85, 0, Math.PI * 2)
    ctx.fillStyle = INK
    ctx.fill()
    const glint = at(dot * 0.5, -dot * 0.5)
    ctx.beginPath()
    ctx.arc(glint.x, glint.y, dot * 0.3, 0, Math.PI * 2)
    ctx.fillStyle = GLINT
    ctx.fill()
    return
  }

  for (const side of [-1, 1]) {
    const eye = at(0, spread * side)

    if (kind === "sleepy") {
      // A closed eye, bulging towards the front. Two of them and the snake
      // looks perfectly happy about all of this.
      const from = at(0, spread * side - dot)
      const to = at(0, spread * side + dot)
      const bulge = at(dot * 1.2, spread * side)
      ctx.beginPath()
      ctx.moveTo(from.x, from.y)
      ctx.quadraticCurveTo(bulge.x, bulge.y, to.x, to.y)
      ctx.strokeStyle = INK
      ctx.lineWidth = Math.max(1.2, size * 0.09)
      ctx.lineCap = "round"
      ctx.stroke()
      continue
    }

    if (kind === "slit") {
      // A pupil standing upright across the line of travel, which is what
      // makes a snake's eye a snake's eye.
      ctx.beginPath()
      ctx.ellipse(eye.x, eye.y, dot * 0.44, dot * 1.2, spin, 0, Math.PI * 2)
      ctx.fillStyle = INK
      ctx.fill()
      continue
    }

    ctx.beginPath()
    ctx.arc(eye.x, eye.y, dot, 0, Math.PI * 2)
    ctx.fillStyle = kind === "fierce" ? ANGRY : INK
    ctx.fill()

    if (kind === "fierce") {
      // A short brow in front of each eye, sloping down towards the middle.
      // It has to stay clear of the eye itself: drawn across one, the pair
      // stops looking like a face and starts looking like a chevron.
      const front = at(dot * 1.75, spread * side - dot * 0.1 * side)
      const back = at(dot * 0.2, spread * side + dot * 1.7 * side)
      ctx.beginPath()
      ctx.moveTo(front.x, front.y)
      ctx.lineTo(back.x, back.y)
      ctx.strokeStyle = INK
      ctx.lineWidth = Math.max(1.2, size * 0.085)
      ctx.lineCap = "round"
      ctx.stroke()
    } else {
      // A glint, which is most of what makes an eye look friendly and costs
      // one more circle to do.
      const glint = at(dot * 0.34, spread * side - dot * 0.34 * side)
      ctx.beginPath()
      ctx.arc(glint.x, glint.y, dot * 0.4, 0, Math.PI * 2)
      ctx.fillStyle = GLINT
      ctx.fill()
    }
  }
}

// A glyph centred in one cell, the way a QML Text sized to the cell centres it.
function glyph(ctx, text, cellX, cellY, cell, size, color, family = "sans-serif") {
  ctx.font = `${size}px ${family}`
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillStyle = color
  ctx.fillText(text, (cellX + 0.5) * cell, (cellY + 0.5) * cell)
}

function label(ctx, text, x, y, size, color, { bold = true, align = "center", spacing = 0 } = {}) {
  ctx.font = `${bold ? "bold " : ""}${size}px ui-monospace, "JetBrains Mono", monospace`
  ctx.textAlign = align
  ctx.textBaseline = "alphabetic"
  ctx.fillStyle = color
  if (!spacing) {
    ctx.fillText(text, x, y)
    return
  }
  // Canvas has letterSpacing only in newer browsers; falling back to drawing
  // the string once keeps the splash readable everywhere.
  if ("letterSpacing" in ctx) {
    ctx.letterSpacing = `${spacing}px`
    ctx.fillText(text, x, y)
    ctx.letterSpacing = "0px"
  } else {
    ctx.fillText(text, x, y)
  }
}

// The versus board is a different size from the single-player one, so the two
// dimensions are arguments with the ported constants as their defaults.
export function boardSize(cell, columns = COLUMNS, rows = ROWS) {
  return { width: columns * cell, height: rows * cell }
}

export function draw(ctx, view) {
  const { game, music, theme, fx, cell } = view
  const colors = theme.colors
  const { width, height } = boardSize(cell)
  const party = music.enabled
  const frequencyColor = level => rgba(mixColors(colors.muted, colors.accent, level))

  ctx.clearRect(0, 0, width, height)

  // --- the board itself ---

  const border = party ? 2 : 1
  fillRound(ctx, 0, 0, width, height, 5, theme.playArea)
  roundRect(ctx, border / 2, border / 2, width - border, height - border, 5)
  ctx.lineWidth = border
  ctx.strokeStyle = party ? frequencyColor(music.treble) : rgba(colors.foreground, 0.22)
  ctx.stroke()

  ctx.save()
  roundRect(ctx, 0, 0, width, height, 5)
  ctx.clip()

  if (party) {
    // The three bands, laid across the board left to right.
    const gradient = ctx.createLinearGradient(0, 0, width, 0)
    gradient.addColorStop(0, rgba(mixColors(colors.background, colors.accent, 0.28 + music.bass * 0.72)))
    gradient.addColorStop(0.5, rgba(mixColors(colors.background, colors.foreground, 0.24 + music.mid * 0.76)))
    gradient.addColorStop(1, rgba(mixColors(colors.accent, colors.foreground, music.treble)))
    ctx.globalAlpha = 0.13
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, width, height)
    ctx.globalAlpha = 1

    if (fx.backgroundPulse > 0) {
      ctx.globalAlpha = fx.backgroundPulse
      ctx.fillStyle = theme.accent
      ctx.fillRect(0, 0, width, height)
      ctx.globalAlpha = 1
    }
  }

  // --- obstacles ---

  const obstacles = game.obstacles
  const obstacleOpacity = (party ? 0.86 : 0.72) * fx.boardContentOpacity
  obstacles.forEach((cellPoint, index) => {
    const band = index % 3
    const bandLevel = band === 0 ? music.bass : band === 1 ? music.mid : music.treble
    const visualLevel = Math.sqrt(bandLevel)
    const x = cellPoint.x * cell + 1
    const y = cellPoint.y * cell + 1
    const size = cell - 2
    ctx.globalAlpha = obstacleOpacity

    if (party && visualLevel > 0) {
      const outer = size + 6 + visualLevel * 10
      ctx.globalAlpha = obstacleOpacity * visualLevel * 0.18
      fillRound(ctx, x + size / 2 - outer / 2, y + size / 2 - outer / 2, outer, outer, 6, theme.accent)
      const inner = size + 3 + visualLevel * 5
      ctx.globalAlpha = obstacleOpacity * visualLevel * 0.32
      fillRound(ctx, x + size / 2 - inner / 2, y + size / 2 - inner / 2, inner, inner, 4, theme.accent)
      ctx.globalAlpha = obstacleOpacity
    }

    fillRound(ctx, x, y, size, size, 2, party ? frequencyColor(bandLevel) : theme.muted)
    if (party && visualLevel > 0.08) {
      ctx.lineWidth = 1
      ctx.strokeStyle = theme.accent
      ctx.stroke()
    }
  })
  ctx.globalAlpha = 1

  // --- the boss ---

  if (game.husks.length) drawHusks(ctx, view)
  // Once the finish starts, the overlay draws whatever is left of the boss
  // itself — drawing it here as well would leave a stray block in the middle
  // of every finishing move.
  const finishing = game.bossPhase === "finish" || game.bossPhase === "fatality"
  if (game.boss.length && !finishing) drawBoss(ctx, view)
  if (game.bossPhase === "fight" && !game.gameOver && game.running) drawEatHim(ctx, view, width)

  // --- the snake ---

  const radius = Math.max(2, cell * 0.2)
  ctx.globalAlpha = fx.boardContentOpacity
  game.snake.forEach((segment, index) => {
    const leadLevel = party ? spectrumRange(music.leadSpectrum, index, game.snake.length) : 0
    const color = !party
      ? (index === 0 ? theme.foreground : theme.accent)
      : (index === 0
        ? rgba(mixColors(colors.foreground, colors.accent, leadLevel))
        : frequencyColor(leadLevel))
    // Every segment lags the one before it, so a beat travels down the body
    // as a wave rather than moving the whole snake at once.
    const dance = party ? fx.danceWave(index) : 0
    const x = segment.x * cell + 1 + dance * 1.8
    const y = segment.y * cell + 1 + dance * (index % 2 === 0 ? 0.8 : -0.8)
    const size = cell - 2
    if (dance === 0) {
      fillRound(ctx, x, y, size, size, radius, color)
      if (index === 0) drawFace(ctx, { x, y, size, direction: game.direction, angry: false })
      return
    }
    ctx.save()
    ctx.translate(x + size / 2, y + size / 2)
    ctx.rotate((dance * 5.5 * Math.PI) / 180)
    fillRound(ctx, -size / 2, -size / 2, size, size, radius, color)
    if (index === 0) drawFace(ctx, { x: -size / 2, y: -size / 2, size, direction: game.direction, angry: false })
    ctx.restore()
  })
  ctx.globalAlpha = 1

  // --- hunters, gates and pickups ---

  if (game.snakeEater.x >= 0) {
    ctx.save()
    ctx.globalAlpha = fx.boardContentOpacity
    const pulse = 1 + 0.1 * Math.sin((performance.now() / 240) * Math.PI)
    ctx.translate((game.snakeEater.x + 0.5) * cell, (game.snakeEater.y + 0.5) * cell)
    ctx.scale(pulse, pulse)
    ctx.translate(-(game.snakeEater.x + 0.5) * cell, -(game.snakeEater.y + 0.5) * cell)
    glyph(ctx, "👾", game.snakeEater.x, game.snakeEater.y, cell, cell * 0.88, theme.foreground)
    ctx.restore()
  }

  if (game.reverseVenom.x >= 0)
    glyph(ctx, "☣", game.reverseVenom.x, game.reverseVenom.y, cell, cell * 0.85, theme.accent)
  if (game.frenzyPickup.x >= 0)
    glyph(ctx, "⚡", game.frenzyPickup.x, game.frenzyPickup.y, cell, cell * 0.85, theme.foreground)
  game.frenzyFoods.forEach((cellPoint, index) => {
    const food = view.foods[index % view.foods.length]
    glyph(ctx, food.glyph, cellPoint.x, cellPoint.y, cell, cell * 0.72, theme.accent, food.family)
  })

  // --- the ball and the goal ---

  if (game.goal.x >= 0) {
    // A net drawn rather than an emoji: it has to read as a target at twelve
    // pixels and sit right in ten themes.
    const x = game.goal.x * cell
    const y = game.goal.y * cell
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 420)
    ctx.globalAlpha = fx.boardContentOpacity * (0.5 + pulse * 0.5)
    roundRect(ctx, x + 2, y + 2, cell - 4, cell - 4, 3)
    ctx.lineWidth = 2
    ctx.strokeStyle = theme.accent
    ctx.stroke()
    ctx.globalAlpha = fx.boardContentOpacity * (0.3 + pulse * 0.3)
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let i = 1; i < 3; ++i) {
      ctx.moveTo(x + 2 + ((cell - 4) * i) / 3, y + 2)
      ctx.lineTo(x + 2 + ((cell - 4) * i) / 3, y + cell - 2)
      ctx.moveTo(x + 2, y + 2 + ((cell - 4) * i) / 3)
      ctx.lineTo(x + cell - 2, y + 2 + ((cell - 4) * i) / 3)
    }
    ctx.stroke()
    ctx.globalAlpha = 1
  }

  if (game.ball.x >= 0) {
    // Rotated rather than trailed: a ball that turns as it travels says which
    // way it is going without leaving ghosts of itself across the board.
    ctx.save()
    ctx.globalAlpha = fx.boardContentOpacity
    ctx.translate((game.ball.x + 0.5) * cell, (game.ball.y + 0.5) * cell)
    ctx.rotate(game.ballSpin)
    ctx.font = `${cell * 0.82}px sans-serif`
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.fillStyle = theme.foreground
    ctx.fillText("⚽", 0, 0)
    ctx.restore()
  }

  // --- food ---

  const food = view.foods[game.foodStyleIndex % view.foods.length]
  ctx.save()
  ctx.globalAlpha = fx.boardContentOpacity
  if (party) {
    ctx.shadowColor = rgba(colors.accent, 0.38 + fx.foodPulse * 0.42)
    ctx.shadowBlur = 24 * (0.7 + music.treble * 0.3)
    const scale = 1 + fx.foodPulse * 0.24
    ctx.translate((game.food.x + 0.5) * cell, (game.food.y + 0.5) * cell)
    ctx.scale(scale, scale)
    ctx.translate(-(game.food.x + 0.5) * cell, -(game.food.y + 0.5) * cell)
  }
  glyph(ctx, food.glyph, game.food.x, game.food.y, cell, cell * 0.85, theme.accent, food.family)
  ctx.restore()

  // The disco ball is the offer of a party, so it only exists before one.
  if (!party && game.discoBall.x >= 0) {
    const discoColor = rgba(mixColors(colors.accent, colors.foreground, fx.discoPulse))
    ctx.save()
    ctx.globalAlpha = fx.boardContentOpacity
    ctx.shadowColor = rgba(mixColors(colors.accent, colors.foreground, fx.discoPulse), 0.35 + fx.discoPulse * 0.45)
    ctx.shadowBlur = 28 * (0.55 + fx.discoPulse * 0.4)
    const scale = 1 + fx.discoPulse * 0.16
    ctx.translate((game.discoBall.x + 0.5) * cell, (game.discoBall.y + 0.5) * cell)
    ctx.scale(scale, scale)
    ctx.translate(-(game.discoBall.x + 0.5) * cell, -(game.discoBall.y + 0.5) * cell)
    glyph(ctx, "🪩", game.discoBall.x, game.discoBall.y, cell, cell * 0.9, discoColor)
    ctx.restore()
  }

  // --- bursts ---

  if (fx.enemyBurst < 1) {
    const negative = fx.enemyBurstText.charAt(0) === "−"
    ctx.globalAlpha = 1 - fx.enemyBurst
    label(ctx, fx.enemyBurstText,
      (fx.enemyBurstX + 0.5) * cell,
      fx.enemyBurstY * cell - fx.enemyBurst * cell * 1.7,
      14, negative ? theme.accent : theme.foreground)
    ctx.globalAlpha = 1
  }

  if (party && fx.foodBurst < 1) {
    for (let index = 0; index < 10; ++index) {
      const angle = (index * Math.PI * 2) / 10
      const distance = cell * (0.45 + (index % 3) * 0.17)
      const size = Math.max(2, cell * 0.13) * (1 - fx.foodBurst * 0.45)
      const x = (fx.burstX + 0.5) * cell + Math.cos(angle) * distance * fx.foodBurst
      const y = (fx.burstY + 0.5) * cell + Math.sin(angle) * distance * fx.foodBurst
      ctx.globalAlpha = (1 - fx.foodBurst) * 0.9
      ctx.beginPath()
      ctx.arc(x, y, size / 2, 0, Math.PI * 2)
      ctx.fillStyle = index % 2 === 0 ? theme.accent : theme.foreground
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }

  if (party && fx.scoreBurst < 1) {
    ctx.globalAlpha = 1 - fx.scoreBurst
    label(ctx, fx.scoreBurstText,
      (fx.burstX + 0.5) * cell,
      fx.burstY * cell - fx.scoreBurst * cell * 1.2,
      13 + (1 - fx.scoreBurst) * 4, theme.foreground)
    ctx.globalAlpha = 1
  }

  if (party && fx.nearMissBurst < 1) {
    const ring = cell * (0.7 + fx.nearMissBurst * 2.2)
    ctx.globalAlpha = 1 - fx.nearMissBurst
    ctx.beginPath()
    ctx.arc((fx.nearMissX + 0.5) * cell, (fx.nearMissY + 0.5) * cell, ring / 2, 0, Math.PI * 2)
    ctx.lineWidth = 2
    ctx.strokeStyle = theme.accent
    ctx.stroke()
    if (fx.nearMissKind === "tailgate") {
      label(ctx, "+1 TAILGATE",
        (fx.nearMissX + 0.5) * cell,
        fx.nearMissY * cell - fx.nearMissBurst * cell * 1.6,
        14, theme.accent)
    } else {
      label(ctx, fx.partyBonusText,
        (fx.nearMissX + 0.5) * cell,
        fx.nearMissY * cell - fx.nearMissBurst * cell * 1.9,
        14, theme.foreground)
    }
    ctx.globalAlpha = 1
  }

  // Two snakes seeing stars after running into each other.
  if (game.dizzy) {
    for (const head of [game.snake[0], game.boss[0]]) {
      if (!head) continue
      drawStars(ctx, (head.x + 0.5) * cell, (head.y + 0.5) * cell - cell * 0.7, cell)
    }
  }

  // --- the finish ---

  // Never underneath GAME OVER: whichever ended the run is the one to read.
  if (!game.gameOver && (game.bossPhase === "finish" || game.bossPhase === "fatality")) {
    drawFinish(ctx, view, width, height)
  }

  // --- overlay ---

  if (game.gameOver || !game.running || game.levelTransition) {
    ctx.fillStyle = "rgba(0, 0, 0, 0.667)"
    ctx.fillRect(0, 0, width, height)
    const title = game.levelTransition
      ? `LEVEL ${levelName(game.completedLevel)} CLEARED`
      : game.gameOver ? "GAME OVER" : "PAUSED"
    const subtitle = game.levelTransition
      ? `Level ${levelName(game.level)} incoming`
      : game.gameOver ? "Space to restart" : "Space to resume"
    const message = game.levelTransition ? view.levelMessage : game.gameOver ? view.gameOverMessage : ""

    const lines = message ? wrap(ctx, message, width - 36, 13) : []
    const blockHeight = 24 + 8 + 15 + (lines.length ? 8 + lines.length * 18 : 0)
    let y = height / 2 - blockHeight / 2 + 20

    label(ctx, title, width / 2, y, 24, "white")
    y += 30
    ctx.globalAlpha = 0.72
    label(ctx, subtitle, width / 2, y, 13, "white", { bold: false })
    ctx.globalAlpha = 0.58
    y += 24
    for (const line of lines) {
      label(ctx, line, width / 2, y, 13, "white", { bold: false })
      y += 18
    }
    ctx.globalAlpha = 1
  }

  ctx.restore()
}

// Three little stars going round, which is the whole vocabulary of dizzy.
function drawStars(ctx, x, y, cell) {
  const spin = performance.now() / 260
  for (let i = 0; i < 3; ++i) {
    const angle = spin + (i * Math.PI * 2) / 3
    const px = x + Math.cos(angle) * cell * 0.42
    const py = y + Math.sin(angle) * cell * 0.18
    const size = cell * (0.1 + 0.04 * Math.sin(spin * 2 + i))
    ctx.fillStyle = "#f7e8a0"
    ctx.beginPath()
    for (let point = 0; point < 10; ++point) {
      const reach = point % 2 === 0 ? size : size * 0.45
      const a = (point / 10) * Math.PI * 2 - Math.PI / 2
      const cx = px + Math.cos(a) * reach
      const cy = py + Math.sin(a) * reach
      if (point === 0) ctx.moveTo(cx, cy)
      else ctx.lineTo(cx, cy)
    }
    ctx.closePath()
    ctx.fill()
  }
}

// The rival. Darker and colder than the snake, with its tail marked, because
// the tail is the only part of it worth aiming at.
function drawBoss(ctx, view) {
  const { game, theme, fx, cell } = view
  const boss = bossFor(view.bossNumber)
  const radius = Math.max(2, cell * 0.22)
  const size = cell - 2
  const tailIndex = game.boss.length - 1

  ctx.globalAlpha = fx.boardContentOpacity
  game.boss.forEach((segment, index) => {
    const x = segment.x * cell + 1
    const y = segment.y * cell + 1
    const head = index === 0
    const tail = index === tailIndex && game.boss.length > 1

    // The tail is the only part of a boss worth aiming at, so it is marked
    // like a target rather than merely shaded differently.
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 180)
    if (tail) {
      const grow = 4 + pulse * 4
      ctx.globalAlpha = fx.boardContentOpacity * (0.3 + pulse * 0.35)
      fillRound(ctx, x - grow / 2, y - grow / 2, size + grow, size + grow, radius + 3, theme.accent)
      ctx.globalAlpha = fx.boardContentOpacity
    }

    fillRound(ctx, x, y, size, size, radius,
      head ? boss.skin : tail ? rgba(mixColors(parseHex(boss.dark), parseHex(boss.skin), 0.4)) : boss.dark)

    if (tail) {
      ctx.lineWidth = 2
      ctx.strokeStyle = theme.accent
      ctx.stroke()
      // A bite mark, so it reads as a target even in a still frame.
      ctx.globalAlpha = fx.boardContentOpacity * (0.55 + pulse * 0.45)
      ctx.beginPath()
      ctx.arc(x + size / 2, y + size / 2, size * 0.22, 0, Math.PI * 2)
      ctx.strokeStyle = theme.foreground
      ctx.lineWidth = Math.max(1.5, size * 0.1)
      ctx.stroke()
      ctx.globalAlpha = fx.boardContentOpacity
    } else if (!head) {
      ctx.lineWidth = 1
      ctx.strokeStyle = boss.skin
      ctx.stroke()
    }

    if (head && game.bossAlert) {
      // It has noticed you. Worth saying so, since it is about to stop
      // dawdling and the player should know why.
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 150)
      const glow = size + 5 + pulse * 5
      ctx.globalAlpha = fx.boardContentOpacity * (0.2 + pulse * 0.25)
      fillRound(ctx, x + size / 2 - glow / 2, y + size / 2 - glow / 2, glow, glow, radius + 3, "#ff4d4d")
      ctx.globalAlpha = fx.boardContentOpacity
      fillRound(ctx, x, y, size, size, radius, boss.skin)
    }

    if (head) {
      // The dangerous end, and the only part of a boss that still kills you.
      const facing = game.boss.length > 1
        ? { x: Math.sign(segment.x - game.boss[1].x), y: Math.sign(segment.y - game.boss[1].y) }
        : { x: -1, y: 0 }
      drawFace(ctx, { x, y, size, direction: facing, angry: true })
    }
  })
  ctx.globalAlpha = 1
}

// The severed pieces. No head, no eyes, no threat — just something wriggling
// about that happens to be worth a point each.
function drawHusks(ctx, view) {
  const { game, fx, cell } = view
  const boss = bossFor(view.bossNumber)
  const radius = Math.max(2, cell * 0.22)
  const size = cell - 2
  const wobble = Math.sin(performance.now() / 260)

  ctx.globalAlpha = fx.boardContentOpacity * 0.85
  for (const husk of game.husks) {
    husk.cells.forEach((segment, index) => {
      const drift = wobble * (index % 2 === 0 ? 1 : -1) * cell * 0.06
      fillRound(ctx, segment.x * cell + 1, segment.y * cell + 1 + drift, size, size, radius, boss.dark)
      ctx.lineWidth = 1
      ctx.strokeStyle = rgba(parseHex(boss.skin), 0.5)
      ctx.stroke()
    })
  }
  ctx.globalAlpha = 1
}

// Says what to do, and the one thing that will stop you doing it. A rule
// nobody can discover is just an unfair death, and this is the whole of it.
function drawEatHim(ctx, view, width) {
  const { theme, cell } = view
  const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 520)
  const top = Math.max(18, cell * 1.1)
  ctx.globalAlpha = 0.3 + pulse * 0.3
  label(ctx, "EAT HIM!", width / 2, top, Math.max(13, cell * 0.62), theme.foreground, { spacing: 2 })
  ctx.globalAlpha = 0.42
  label(ctx, "not head-on — he'll butt you back", width / 2, top + Math.max(12, cell * 0.5), Math.max(9, cell * 0.36), theme.muted, { bold: false })
  ctx.globalAlpha = 1
}

// FINISH HIM, and then whatever was pressed.
function drawFinish(ctx, view, width, height) {
  const { game, theme, cell } = view
  const finishing = game.bossPhase === "fatality"
  const head = game.boss[0]

  ctx.fillStyle = "rgba(0, 0, 0, 0.55)"
  ctx.fillRect(0, 0, width, height)

  // While the finish is still being decided, the last segment sits there
  // thrashing. Once a move has been chosen, that move owns the head — and
  // eventually stops owning it, at some speed, in several directions.
  if (head && !finishing) {
    const pulse = 1 + 0.14 * Math.sin(performance.now() / 120)
    const boss = bossFor(view.bossNumber)
    // Charging the head leaves both heads in one cell. Nudging the boss's
    // ahead of the snake's turns an overlap into a mouthful.
    const snakeHead = game.snake[0]
    const shared = snakeHead && snakeHead.x === head.x && snakeHead.y === head.y
    const nudgeX = shared ? game.direction.x * cell * 0.3 : 0
    const nudgeY = shared ? game.direction.y * cell * 0.3 : 0
    ctx.save()
    ctx.translate((head.x + 0.5) * cell + nudgeX, (head.y + 0.5) * cell + nudgeY)
    ctx.scale(pulse, pulse)
    fillRound(ctx, -cell / 2, -cell / 2, cell - 2, cell - 2, cell * 0.25, boss.skin)
    ctx.restore()
  }

  if (!finishing) {
    const flash = Math.sin(performance.now() / 140) > -0.3
    if (flash) {
      label(ctx, "FINISH HIM!", width / 2, height * 0.32, Math.max(20, cell * 1.1), "#f7768e", { spacing: 3 })
    }
    // A cheat sheet, because a fatality nobody can find is just a timer.
    let y = height * 0.44
    for (const fatality of view.fatalities) {
      label(ctx, `${arrowsFor(fatality.keys)}   ${fatality.name}`, width / 2, y, Math.max(10, cell * 0.44), "white", { bold: false })
      y += Math.max(14, cell * 0.62)
    }
    // What has been pressed so far, and how long is left.
    const pressed = view.finisherInputs.slice(-4)
    if (pressed.length) {
      label(ctx, arrowsFor(pressed), width / 2, height * 0.86, Math.max(14, cell * 0.7), theme.accent)
    }
    const barWidth = width * 0.6 * game.finishProgress
    ctx.fillStyle = rgba(view.theme.colors.accent, 0.9)
    ctx.fillRect((width - barWidth) / 2, height * 0.9, barWidth, Math.max(3, cell * 0.12))
    return
  }

  const progress = Math.max(0, Math.min(1, view.fatalityProgress))
  const boss = bossFor(view.bossNumber)
  const centre = head
    ? { x: (head.x + 0.5) * cell, y: (head.y + 0.5) * cell }
    : { x: width / 2, y: height / 2 }

  const animation = FATALITY_ANIMATIONS[view.fatalityId] || FATALITY_ANIMATIONS.mercy
  animation(ctx, { boss, centre, cell, width, height, theme, progress })

  // The name arrives once there has been something to watch, on a plate,
  // because the boss died wherever it died and this has to be readable on top
  // of whatever just happened to it.
  if (progress < 0.3) return
  const arrival = Math.min(1, (progress - 0.3) / 0.18)
  // Along the bottom rather than across the middle: a boss dies wherever it
  // was standing, and the middle is where its finishing move is happening.
  const lines = wrap(ctx, view.fatalityFlavour, width - 80, 13)
  const nameSize = Math.max(17, cell * 0.85)
  const baseline = height - 18 - lines.length * 18
  const plateTop = baseline - nameSize - 12
  ctx.globalAlpha = arrival
  ctx.fillStyle = "rgba(0, 0, 0, 0.78)"
  ctx.fillRect(0, plateTop, width, height - plateTop)

  label(ctx, view.fatalityName, width / 2, baseline, nameSize, "#f7768e", { spacing: 2 })
  let y = baseline + 20
  for (const line of lines) {
    label(ctx, line, width / 2, y, 13, "white", { bold: false })
    y += 18
  }
  ctx.globalAlpha = 1
}

// --- finishing moves ---------------------------------------------------------
//
// One per combination. They are deliberately over the top: the whole point of
// spending five seconds on a sequence is to be shown something for it.

const bossBlock = (ctx, boss, x, y, size, radius) => fillRound(ctx, x - size / 2, y - size / 2, size, size, radius, boss.skin)

// Deterministic per-particle noise. The burst has to look the same on every
// frame it is drawn at, and keeping no state is what guarantees that.
const scatter = (i, salt) => {
  const value = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453
  return value - Math.floor(value)
}

const BLOOD = ["#c1121f", "#8b0000", "#ff4d4d", "#6b0f1a"]

// The head coming apart. `t` runs 0 to 1 across the burst; everything else is
// how it comes apart — which way, how hard, and whether in drops or in chunks.
function gore(ctx, {
  x, y, cell, t, boss,
  count = 30,
  baseAngle = 0,
  spread = Math.PI * 2,
  speed = 1,
  gravity = 1,
  chunky = false
}) {
  if (t <= 0) return
  const fade = Math.max(0, 1 - t * 0.85)

  // The flash of the moment itself.
  if (t < 0.22) {
    const flash = 1 - t / 0.22
    ctx.globalAlpha = flash * 0.85
    const glow = ctx.createRadialGradient(x, y, 0, x, y, cell * (1.5 + t * 8))
    glow.addColorStop(0, "#fff3f3")
    glow.addColorStop(0.4, "#ff4d4d")
    glow.addColorStop(1, "rgba(193, 18, 31, 0)")
    ctx.fillStyle = glow
    ctx.beginPath()
    ctx.arc(x, y, cell * (1.5 + t * 8), 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 1
  }

  for (let i = 0; i < count; ++i) {
    const angle = baseAngle + (scatter(i, 3) - 0.5) * spread
    const velocity = cell * (2 + scatter(i, 7) * 5) * speed
    const px = x + Math.cos(angle) * velocity * t
    const py = y + Math.sin(angle) * velocity * t + gravity * cell * 10 * t * t
    const size = Math.max(1.3, cell * (0.06 + scatter(i, 11) * 0.14) * (0.55 + fade * 0.45))
    ctx.globalAlpha = fade
    // Mostly blood, and some of whatever it was made of.
    const bit = scatter(i, 13)
    ctx.fillStyle = bit < 0.7 ? BLOOD[i % BLOOD.length] : bit < 0.88 ? boss.skin : boss.dark

    if (chunky && bit >= 0.7) {
      ctx.save()
      ctx.translate(px, py)
      ctx.rotate(angle + t * 6)
      ctx.fillRect(-size, -size, size * 2, size * 2)
      ctx.restore()
    } else {
      ctx.beginPath()
      // Drops stretch along the way they are travelling.
      ctx.ellipse(px, py, size * (1 + t * 0.8), size, angle, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.globalAlpha = 1
}

// What is left on the floor afterwards. Appears with the burst and stays.
function splatter(ctx, { x, y, cell, t, count = 9, baseAngle = 0, spread = Math.PI * 2, reach = 3 }) {
  if (t <= 0) return
  const settle = Math.min(1, t * 3)
  ctx.globalAlpha = 0.6 * Math.max(0, 1 - t * 0.5)
  for (let i = 0; i < count; ++i) {
    const angle = baseAngle + (scatter(i, 17) - 0.5) * spread
    const distance = cell * reach * (0.25 + scatter(i, 19) * 0.75) * settle
    const size = cell * (0.1 + scatter(i, 23) * 0.22)
    ctx.fillStyle = BLOOD[(i + 1) % BLOOD.length]
    ctx.beginPath()
    ctx.ellipse(x + Math.cos(angle) * distance, y + Math.sin(angle) * distance,
      size, size * (0.5 + scatter(i, 29) * 0.6), angle, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

// How far through a burst we are, given when it starts.
const after = (progress, bang) => (progress < bang ? 0 : (progress - bang) / (1 - bang))

const FATALITY_ANIMATIONS = {
  // The board tears itself into bands, and then the head shatters with it.
  "kernel-panic": (ctx, { boss, centre, cell, width, height, progress }) => {
    const bang = 0.6
    const burst = after(progress, bang)
    const violence = progress < bang ? 1 : Math.max(0, 1 - burst)
    const bands = 14
    for (let i = 0; i < bands; ++i) {
      const bandHeight = height / bands
      const offset = (Math.random() - 0.5) * cell * 3 * violence
      ctx.globalAlpha = 0.5 * violence
      ctx.fillStyle = i % 3 === 0 ? "#ff4d4d" : i % 3 === 1 ? boss.skin : "#1e1e6e"
      ctx.fillRect(offset, i * bandHeight, width, bandHeight * 0.5)
    }
    ctx.globalAlpha = 1

    if (!burst) {
      const shake = (Math.random() - 0.5) * cell * violence
      bossBlock(ctx, boss, centre.x + shake, centre.y + shake, (cell - 2) * (1 - progress * 0.4), cell * 0.25)
      return
    }
    // The crash screen goes down first so the mess lands on top of it.
    ctx.globalAlpha = Math.min(0.9, burst * 1.4)
    ctx.fillStyle = "#1e1e6e"
    ctx.fillRect(0, 0, width, height)
    ctx.globalAlpha = 1
    for (let i = 0; i < 5; ++i) {
      const line = Array.from({ length: 18 }, () => Math.floor(Math.random() * 16).toString(16)).join("")
      label(ctx, `0x${line}`, width / 2, height * 0.34 + i * 15, 11, "#9fb3ff", { bold: false })
    }

    splatter(ctx, { x: centre.x, y: centre.y, cell, t: burst, count: 12, reach: 4 })
    gore(ctx, { x: centre.x, y: centre.y, cell, t: burst, boss, count: 40, speed: 1.25, chunky: true })
  },

  // Two versions of it, and both of them burst.
  "merge-conflict": (ctx, { boss, centre, cell, theme, progress }) => {
    const bang = 0.62
    const burst = after(progress, bang)
    const drift = Math.min(progress, bang) * cell * 4.5

    if (!burst) {
      const size = (cell - 2) * (1 - progress * 0.25)
      bossBlock(ctx, boss, centre.x - drift, centre.y, size, cell * 0.25)
      bossBlock(ctx, boss, centre.x + drift, centre.y, size, cell * 0.25)
    } else {
      for (const side of [-1, 1]) {
        const x = centre.x + drift * side
        splatter(ctx, { x, y: centre.y, cell, t: burst, count: 7, baseAngle: side > 0 ? 0 : Math.PI, spread: Math.PI, reach: 2.6 })
        gore(ctx, {
          x, y: centre.y, cell, t: burst, boss, count: 22,
          baseAngle: side > 0 ? 0 : Math.PI, spread: Math.PI * 1.1, speed: 1.1
        })
      }
    }

    const gap = Math.max(12, cell * 0.5)
    ctx.globalAlpha = Math.min(1, progress * 2.2) * (burst ? Math.max(0, 1 - burst) : 1)
    label(ctx, "<<<<<<< HEAD", centre.x, centre.y - gap, Math.max(10, cell * 0.4), theme.foreground, { bold: false })
    label(ctx, "=======", centre.x, centre.y + 4, Math.max(10, cell * 0.4), "#ff4d4d", { bold: false })
    label(ctx, ">>>>>>> them", centre.x, centre.y + gap + 4, Math.max(10, cell * 0.4), theme.foreground, { bold: false })
    ctx.globalAlpha = 1
  },

  // Swept up, and then swept up rather harder.
  "garbage-collected": (ctx, { boss, centre, cell, theme, progress }) => {
    const bang = 0.72
    const burst = after(progress, bang)
    const held = Math.min(progress, bang)
    const lift = cell * 5 * held

    for (let i = 0; i < 22; ++i) {
      const phase = (held * 1.6 + i / 22) % 1
      const angle = i * 2.4 + held * 6
      const radius = cell * 2.8 * (1 - phase)
      ctx.globalAlpha = (1 - phase) * 0.85 * (1 - burst)
      ctx.fillStyle = i % 2 === 0 ? boss.skin : theme.accent
      ctx.beginPath()
      ctx.arc(centre.x + Math.cos(angle) * radius, centre.y + Math.sin(angle) * radius - lift * phase,
        Math.max(1.5, cell * 0.1 * (1 - phase)), 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1

    const x = centre.x
    const y = centre.y - lift
    if (!burst) {
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(held * Math.PI * 3)
      const size = (cell - 2) * Math.max(0.35, 1 - held)
      fillRound(ctx, -size / 2, -size / 2, size, size, cell * 0.25, boss.skin)
      ctx.restore()
      return
    }
    // Taken up the pipe: everything goes with it, and very little comes down.
    gore(ctx, {
      x, y, cell, t: burst, boss, count: 34,
      baseAngle: -Math.PI / 2, spread: Math.PI * 0.9, speed: 1.3, gravity: -0.35
    })
    splatter(ctx, { x, y, cell, t: burst, count: 6, baseAngle: -Math.PI / 2, spread: Math.PI, reach: 2.2 })
  },

  // Popped one frame at a time, and the last one is the head.
  "stack-unwound": (ctx, { boss, centre, cell, theme, progress }) => {
    const bang = 0.76
    const burst = after(progress, bang)
    const frames = 6
    const size = cell - 2

    for (let i = 1; i < frames; ++i) {
      const popAt = (i / frames) * bang
      if (progress < popAt) {
        ctx.globalAlpha = 0.85
        fillRound(ctx, centre.x - size / 2, centre.y - size / 2 - i * (size + 3), size, size, cell * 0.2, boss.dark)
        ctx.lineWidth = 1
        ctx.strokeStyle = theme.foreground
        ctx.stroke()
      } else {
        const flight = Math.min(1, (progress - popAt) * 3)
        ctx.globalAlpha = (1 - flight) * 0.9
        fillRound(ctx, centre.x - size / 2 + (i % 2 ? 1 : -1) * flight * cell,
          centre.y - i * (size + 3) - flight * cell * 6 - size / 2, size, size, cell * 0.2, boss.dark)
      }
    }
    ctx.globalAlpha = 1

    if (!burst) {
      bossBlock(ctx, boss, centre.x, centre.y, size, cell * 0.2)
      return
    }
    // The base frame goes last, and it goes downwards.
    gore(ctx, {
      x: centre.x, y: centre.y, cell, t: burst, boss, count: 32,
      baseAngle: Math.PI / 2, spread: Math.PI * 1.4, speed: 0.9, gravity: 2.2, chunky: true
    })
    splatter(ctx, { x: centre.x, y: centre.y, cell, t: burst, count: 10, baseAngle: Math.PI / 2, spread: Math.PI, reach: 3.4 })
  },

  // Blasted across the board, and stopped by the far wall.
  "force-pushed": (ctx, { boss, centre, cell, width, height, theme, progress }) => {
    const bang = 0.66
    const burst = after(progress, bang)
    const travel = Math.min(progress, bang) / bang
    const wallX = width - cell * 0.9
    const x = centre.x + (wallX - centre.x) * travel * travel

    for (let ring = 0; ring < 3; ++ring) {
      const phase = Math.max(0, Math.min(1, progress * 1.6 - ring * 0.18))
      if (phase <= 0 || phase >= 1) continue
      ctx.globalAlpha = (1 - phase) * 0.8
      ctx.beginPath()
      ctx.arc(centre.x, centre.y, phase * cell * 7, 0, Math.PI * 2)
      ctx.strokeStyle = theme.accent
      ctx.lineWidth = Math.max(2, cell * 0.14)
      ctx.stroke()
    }
    ctx.globalAlpha = 1

    for (let i = 6; i >= 0; --i) {
      const trailX = x - i * cell * 0.9
      if (trailX < -cell) continue
      ctx.globalAlpha = (1 - i / 7) * (1 - progress * 0.4) * (burst ? Math.max(0, 1 - burst * 2) : 1)
      bossBlock(ctx, boss, trailX, centre.y, (cell - 2) * (1 - i * 0.07), cell * 0.25)
    }
    ctx.globalAlpha = 1

    if (burst) {
      // Against the wall, so everything comes back the way it went.
      gore(ctx, {
        x: wallX, y: centre.y, cell, t: burst, boss, count: 34,
        baseAngle: Math.PI, spread: Math.PI * 1.2, speed: 1.15, gravity: 1.4
      })
      splatter(ctx, { x: wallX, y: centre.y, cell, t: burst, count: 11, baseAngle: Math.PI, spread: Math.PI * 0.9, reach: 3 })
    }

    if (progress > 0.72) {
      ctx.globalAlpha = Math.min(1, (progress - 0.72) / 0.2)
      label(ctx, "+ forced update", width / 2, height * 0.72, Math.max(11, cell * 0.44), theme.muted, { bold: false })
      ctx.globalAlpha = 1
    }
  },

  // Nothing happens, at length, and then a little happens.
  mercy: (ctx, { boss, centre, cell, theme, progress }) => {
    const bang = 0.82
    const burst = after(progress, bang)
    const sag = Math.min(1, Math.min(progress, bang) * 1.2)

    if (!burst) {
      const size = (cell - 2) * (1 - sag * 0.55)
      ctx.globalAlpha = 1 - sag * 0.3
      fillRound(ctx, centre.x - size / 2, centre.y - size / 2 + sag * cell * 0.4,
        size, size * (1 - sag * 0.3), cell * 0.25, boss.skin)
      ctx.globalAlpha = 1
    } else {
      gore(ctx, { x: centre.x, y: centre.y, cell, t: burst, boss, count: 12, speed: 0.5, gravity: 2 })
      splatter(ctx, { x: centre.x, y: centre.y, cell, t: burst, count: 4, reach: 1.4 })
    }

    if (progress > 0.25 && !burst) {
      ctx.globalAlpha = Math.min(1, (progress - 0.25) * 3) * 0.8
      label(ctx, ". . .", centre.x, centre.y - cell * 1.1, Math.max(12, cell * 0.6), theme.muted, { bold: false })
      ctx.globalAlpha = 1
    }
  }
}

const ARROWS = { up: "↑", down: "↓", left: "←", right: "→" }
const arrowsFor = keys => keys.map(key => ARROWS[key] || "?").join(" ")

// Word wrapping for the level-clear and game-over lines, which are written to
// be read rather than truncated.
function wrap(ctx, text, maxWidth, size) {
  ctx.font = `${size}px ui-monospace, "JetBrains Mono", monospace`
  const words = text.split(" ")
  const lines = []
  let current = ""
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (ctx.measureText(candidate).width > maxWidth && current) {
      lines.push(current)
      current = word
    } else {
      current = candidate
    }
  }
  if (current) lines.push(current)
  return lines
}

// The boss's introduction: portrait, name and epithet, on the same card the
// Party Mode splash uses so the two read as the same kind of announcement.
export function drawBossSplash(ctx, view) {
  const { theme, fx, width, height } = view
  if (fx.partySplashOpacity <= 0) return
  const colors = theme.colors
  const boss = bossFor(view.bossNumber)

  ctx.clearRect(0, 0, width, height)
  ctx.globalAlpha = fx.partySplashOpacity
  ctx.fillStyle = rgba(colors.background, 0.82)
  ctx.fillRect(0, 0, width, height)

  const cardWidth = Math.min(width - 48, 470)
  const cardHeight = 188
  ctx.save()
  ctx.translate(width / 2, height / 2)
  ctx.scale(fx.partySplashScale, fx.partySplashScale)
  ctx.translate(-cardWidth / 2, -cardHeight / 2)

  ctx.shadowColor = boss.skin
  ctx.shadowBlur = 34
  fillRound(ctx, 0, 0, cardWidth, cardHeight, 18, rgba(mixColors(colors.background, colors.foreground, 0.08)))
  ctx.shadowBlur = 0
  ctx.lineWidth = 3
  ctx.strokeStyle = boss.skin
  ctx.stroke()

  const stripe = ctx.createLinearGradient(0, 0, cardWidth, 0)
  stripe.addColorStop(0, boss.dark)
  stripe.addColorStop(0.5, boss.skin)
  stripe.addColorStop(1, boss.dark)
  fillRound(ctx, 0, 0, cardWidth, 7, 4, stripe)

  const portrait = 118
  drawPortrait(ctx, boss, 22, (cardHeight - portrait) / 2 + 6, portrait)

  const textLeft = 22 + portrait + 20
  ctx.textAlign = "left"
  label(ctx, "CHALLENGER", textLeft, cardHeight / 2 - 34, 11, theme.muted, { align: "left", spacing: 3 })
  label(ctx, boss.name, textLeft, cardHeight / 2 - 6, 25, theme.foreground, { align: "left", spacing: 1 })
  for (const [index, line] of wrap(ctx, boss.epithet, cardWidth - textLeft - 22, 12).entries()) {
    label(ctx, line, textLeft, cardHeight / 2 + 20 + index * 17, 12, boss.skin, { align: "left", bold: false })
  }
  ctx.textAlign = "center"
  ctx.restore()
  ctx.globalAlpha = 1
}

// The Party Mode splash, drawn over the whole page rather than the board.
export function drawSplash(ctx, view) {
  const { theme, fx, width, height } = view
  if (fx.partySplashOpacity <= 0) return
  const colors = theme.colors

  ctx.clearRect(0, 0, width, height)
  ctx.globalAlpha = fx.partySplashOpacity
  ctx.fillStyle = rgba(colors.background, 0.76)
  ctx.fillRect(0, 0, width, height)

  const cardWidth = Math.min(width - 48, 430)
  const cardHeight = 154
  ctx.save()
  ctx.translate(width / 2, height / 2)
  ctx.scale(fx.partySplashScale, fx.partySplashScale)
  ctx.translate(-cardWidth / 2, -cardHeight / 2)

  ctx.shadowColor = rgba(colors.accent, 0.75)
  ctx.shadowBlur = 32
  fillRound(ctx, 0, 0, cardWidth, cardHeight, 18, rgba(mixColors(colors.background, colors.accent, 0.16)))
  ctx.shadowBlur = 0
  ctx.lineWidth = 3
  ctx.strokeStyle = theme.accent
  ctx.stroke()

  const stripe = ctx.createLinearGradient(0, 0, cardWidth, 0)
  stripe.addColorStop(0, theme.muted)
  stripe.addColorStop(0.5, theme.foreground)
  stripe.addColorStop(1, theme.accent)
  fillRound(ctx, 0, 0, cardWidth, 7, 4, stripe)

  label(ctx, "PARTY MODE", cardWidth / 2, cardHeight / 2 + 2, 34, theme.foreground, { spacing: 5 })
  label(ctx, view.trackName, cardWidth / 2, cardHeight / 2 + 34, 15, theme.accent)
  ctx.restore()
  ctx.globalAlpha = 1
}

// ---------------------------------------------------------------------------
// Versus
// ---------------------------------------------------------------------------

// What a snake ran into, said plainly. A round that ends has to say why, or a
// player who was watching the other half of the board never finds out.
const CRASH_REASONS = {
  wall: "into the wall",
  self: "into itself",
  rival: "into the other snake",
  "head-on": "nose to nose",
  stalemate: "neither of them blinked"
}

// Both snakes come out of the theme rather than out of a fixed pair of
// colours, because all ten palettes have to stay readable and only the six
// theme names are the game's to use. They share the two a single-player snake
// already wears and swap them over.
//
// Colour alone will not carry it, though: in half the palettes the accent and
// the foreground are two shades of the same blue, and two snakes a player
// cannot tell apart at a glance is not a duel. So the second snake is round
// where the first is square — the one difference that survives every palette,
// and reads at twelve pixels as well as at forty. The numbered tag above each
// head settles anything left at the start of a round, which is when nothing is
// moving and there is time to read it.
const versusSkin = (theme, seat) => seat === 0
  ? { body: theme.accent, head: theme.foreground, round: false }
  : { body: theme.foreground, head: theme.accent, round: true }

// One head on its own, for the picker. It draws the block as well as the face,
// because which shape a seat is — square or round — is half of how the two
// snakes are told apart, and somebody choosing a face may as well be shown the
// rest of what they are about to be.
// The outline of one head, so a face can be clipped to it. A brow drawn to the
// corner of the block it was given lands outside a round head, which on a
// circle reads as whiskers rather than as a brow.
function headPath(ctx, { x, y, size, round, radius }) {
  ctx.beginPath()
  if (round) ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2)
  else ctx.roundRect(x, y, size, size, radius)
}

// A face, kept inside the head it belongs to.
function drawHeadFace(ctx, { x, y, size, round, radius, direction, head }) {
  ctx.save()
  headPath(ctx, { x, y, size, round, radius })
  ctx.clip()
  drawFace(ctx, { x, y, size, direction, angry: false, head })
  ctx.restore()
}

export function drawHeadPreview(ctx, { theme, seat, head, size }) {
  const skin = versusSkin(theme, seat)
  const block = size * 0.74
  const offset = (size - block) / 2
  ctx.clearRect(0, 0, size, size)

  if (skin.round) {
    ctx.beginPath()
    ctx.arc(size / 2, size / 2, block / 2, 0, Math.PI * 2)
    ctx.fillStyle = skin.head
    ctx.fill()
  } else fillRound(ctx, offset, offset, block, block, Math.max(2, block * 0.2), skin.head)

  // Facing the way that seat faces at the start of a round.
  drawHeadFace(ctx, {
    x: offset,
    y: offset,
    size: block,
    round: skin.round,
    radius: Math.max(2, block * 0.2),
    direction: { x: seat === 0 ? 1 : -1, y: 0 },
    head
  })
}

export function drawVersus(ctx, view) {
  const { versus, theme, cell } = view
  const colors = theme.colors
  const { width, height } = boardSize(cell, versus.columns, versus.rows)

  ctx.clearRect(0, 0, width, height)

  fillRound(ctx, 0, 0, width, height, 5, theme.playArea)
  roundRect(ctx, 0.5, 0.5, width - 1, height - 1, 5)
  ctx.lineWidth = 1
  ctx.strokeStyle = rgba(colors.foreground, 0.22)
  ctx.stroke()

  ctx.save()
  roundRect(ctx, 0, 0, width, height, 5)
  ctx.clip()

  for (const wall of versus.obstacles) {
    fillRound(ctx, wall.x * cell + 1, wall.y * cell + 1, cell - 2, cell - 2, 2, theme.muted)
  }

  const radius = Math.max(2, cell * 0.2)
  // Tags belong to the moments when the board is not moving: at the start of a
  // round they are wanted, and mid-round they would be two labels dragged
  // around the board for no reason.
  const tagged = versus.phase === "countdown" || versus.phase === "roundOver"

  versus.players.forEach((player, seat) => {
    const skin = versusSkin(theme, seat)
    ctx.globalAlpha = player.alive ? 1 : 0.42
    player.snake.forEach((segment, index) => {
      const size = skin.round ? cell - 1 : cell - 2
      const x = segment.x * cell + (cell - size) / 2
      const y = segment.y * cell + (cell - size) / 2
      const colour = index === 0 ? skin.head : skin.body
      if (skin.round) {
        ctx.beginPath()
        ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2)
        ctx.fillStyle = colour
        ctx.fill()
      } else fillRound(ctx, x, y, size, size, radius, colour)
      if (index === 0) {
        drawHeadFace(ctx, {
          x, y, size, radius, round: skin.round, direction: player.direction, head: player.head
        })
      }
    })
    const head = player.snake[0]
    if (tagged && head) {
      label(ctx, String(seat + 1), (head.x + 0.5) * cell, head.y * cell - cell * 0.18,
        Math.max(10, cell * 0.6), skin.head)
    }
    ctx.globalAlpha = 1

    // The cell it was heading for, marked where it never got to. Red is the
    // one colour outside the palette the game already uses for something being
    // wrong, in a boss's eyes.
    if (!player.alive && player.crashAt) {
      const x = (player.crashAt.x + 0.5) * cell
      const y = (player.crashAt.y + 0.5) * cell
      const arm = cell * 0.3
      ctx.beginPath()
      ctx.moveTo(x - arm, y - arm)
      ctx.lineTo(x + arm, y + arm)
      ctx.moveTo(x + arm, y - arm)
      ctx.lineTo(x - arm, y + arm)
      ctx.lineWidth = Math.max(2, cell * 0.12)
      ctx.lineCap = "round"
      ctx.strokeStyle = "#ff4d4d"
      ctx.stroke()
    }
  })

  if (versus.food.x >= 0) {
    const food = view.foods[view.foodStyleIndex % view.foods.length]
    glyph(ctx, food.glyph, versus.food.x, versus.food.y, cell, cell * 0.85, theme.accent, food.family)
  }

  if (versus.phase !== "playing") drawVersusOverlay(ctx, view, width, height)

  ctx.restore()
}

// The name of a seat as this browser should say it: two players at one
// keyboard are "PLAYER 1" and "PLAYER 2", and two players in two rooms are
// "YOU" and "THEM".
export const versusName = (seat, mySeat) =>
  mySeat === null || mySeat === undefined
    ? `PLAYER ${seat + 1}`
    : seat === mySeat ? "YOU" : "THEM"

// Why the round ended. When both of them went the same way there is one thing
// to say; otherwise each of the fallen says its own.
function crashLine(versus, seat) {
  const [first, second] = versus.players
  if (first.reason && first.reason === second.reason) {
    return CRASH_REASONS[first.reason] || "both at once"
  }
  return versus.players
    .map((player, index) =>
      player.alive ? null : `${versusName(index, seat)} — ${CRASH_REASONS[player.reason] || "out"}`)
    .filter(Boolean)
    .join("   ·   ")
}

function drawVersusOverlay(ctx, view, width, height) {
  const { versus, theme } = view
  const seat = view.seat

  ctx.fillStyle = "rgba(0, 0, 0, 0.667)"
  ctx.fillRect(0, 0, width, height)

  let title = ""
  let subtitle = ""
  let note = ""

  if (versus.phase === "lobby") {
    title = "WAITING"
    subtitle = view.lobbyNote || "for a second player"
  } else if (versus.phase === "countdown") {
    title = `ROUND ${versus.round}`
    subtitle = view.hint || ""
  } else if (versus.phase === "roundOver") {
    const winner = versus.roundWinner
    // "ROUND TO YOU" rather than "YOU WIN THE ROUND", because the same
    // sentence has to work for "THEM" and for "PLAYER 2" without the verb
    // changing under it.
    title = winner === -1 ? "NOBODY TAKES IT" : `ROUND TO ${versusName(winner, seat)}`
    subtitle = crashLine(versus, seat)
  } else if (versus.phase === "matchOver") {
    title = `MATCH TO ${versusName(versus.matchWinner, seat)}`
    subtitle = view.rematchNote || "Space for a rematch"
  }

  // The tally, spelled out rather than left to the strip above the board:
  // fullscreen or not, the thing being looked at is the board.
  if (versus.phase !== "lobby") {
    note = `${versusName(0, seat)} ${versus.players[0].wins} — ${versus.players[1].wins} ${versusName(1, seat)}`
  }

  const lines = subtitle ? wrap(ctx, subtitle, width - 36, 13) : []
  const counting = versus.phase === "countdown"
  const blockHeight = 24 + (counting ? 56 : 0) + 8 + (lines.length ? lines.length * 18 : 0) + (note ? 26 : 0)
  let y = height / 2 - blockHeight / 2 + 20

  label(ctx, title, width / 2, y, 24, "white")
  y += counting ? 62 : 30

  if (counting) {
    label(ctx, String(versus.countdownSeconds || "GO"), width / 2, y, 54, theme.accent)
    y += 26
  }

  ctx.globalAlpha = 0.72
  for (const line of lines) {
    label(ctx, line, width / 2, y, 13, "white", { bold: false })
    y += 18
  }
  if (note) {
    ctx.globalAlpha = 0.9
    y += 8
    label(ctx, note, width / 2, y, 14, "white")
  }
  ctx.globalAlpha = 1
}
