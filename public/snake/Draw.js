// The board, drawn — a port of the Qt Quick scene in `src/Main.qml`.
//
// Only the board is canvas. Scores, meters and buttons stay real DOM elements
// so they keep their text, focus rings and accessible names, exactly as the
// Qt version keeps them as real controls rather than painted rectangles.
//
// Everything here reads state and draws it. Timers, input and animation values
// belong to web.js; game rules belong to Game.js.

import { COLUMNS, ROWS } from "./Game.js"
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

export function boardSize(cell) {
  return { width: COLUMNS * cell, height: ROWS * cell }
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

  if (game.boss.length) drawBoss(ctx, view)

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
      return
    }
    ctx.save()
    ctx.translate(x + size / 2, y + size / 2)
    ctx.rotate((dance * 5.5 * Math.PI) / 180)
    fillRound(ctx, -size / 2, -size / 2, size, size, radius, color)
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

  for (const gate of game.beatGates) {
    const x = gate.x * cell + 2
    const y = gate.y * cell + 2
    const size = cell - 4
    ctx.globalAlpha = game.beatGatesOpen ? 0.25 : 0.9
    if (!game.beatGatesOpen) fillRound(ctx, x, y, size, size, 3, theme.accent)
    else roundRect(ctx, x, y, size, size, 3)
    ctx.lineWidth = 2
    ctx.strokeStyle = theme.foreground
    ctx.stroke()
    ctx.globalAlpha = 1
  }

  if (game.reverseVenom.x >= 0)
    glyph(ctx, "☣", game.reverseVenom.x, game.reverseVenom.y, cell, cell * 0.85, theme.accent)
  if (game.frenzyPickup.x >= 0)
    glyph(ctx, "⚡", game.frenzyPickup.x, game.frenzyPickup.y, cell, cell * 0.85, theme.foreground)
  game.frenzyFoods.forEach((cellPoint, index) => {
    const food = view.foods[index % view.foods.length]
    glyph(ctx, food.glyph, cellPoint.x, cellPoint.y, cell, cell * 0.72, theme.accent, food.family)
  })

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
      ? `LEVEL ${game.completedLevel} CLEARED`
      : game.gameOver ? "GAME OVER" : "PAUSED"
    const subtitle = game.levelTransition
      ? `Level ${game.level} incoming`
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

    if (head) {
      // Two eyes, so it is obvious which end is coming for you.
      const eye = Math.max(1.5, cell * 0.11)
      ctx.fillStyle = "#101014"
      ctx.beginPath()
      ctx.arc(x + size * 0.33, y + size * 0.36, eye, 0, Math.PI * 2)
      ctx.arc(x + size * 0.67, y + size * 0.36, eye, 0, Math.PI * 2)
      ctx.fill()
    }
  })
  ctx.globalAlpha = 1
}

// FINISH HIM, and then whatever was pressed.
function drawFinish(ctx, view, width, height) {
  const { game, theme, cell } = view
  const finishing = game.bossPhase === "fatality"
  const head = game.boss[0]

  ctx.fillStyle = "rgba(0, 0, 0, 0.55)"
  ctx.fillRect(0, 0, width, height)

  if (head) {
    // The last segment left, thrashing.
    const shake = finishing ? Math.sin(performance.now() / 26) * cell * 0.22 : 0
    const pulse = 1 + 0.14 * Math.sin(performance.now() / 120)
    const boss = bossFor(view.bossNumber)
    ctx.save()
    ctx.translate((head.x + 0.5) * cell + shake, (head.y + 0.5) * cell)
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

  // A plate behind the words, because the boss died wherever it died and the
  // text has to be readable on top of it.
  const lines = wrap(ctx, view.fatalityFlavour, width - 80, 13)
  const nameSize = Math.max(18, cell * 0.95)
  const top = height * 0.34 - nameSize
  const plateHeight = nameSize + 14 + lines.length * 18 + 16
  ctx.fillStyle = "rgba(0, 0, 0, 0.72)"
  ctx.fillRect(0, top, width, plateHeight)

  label(ctx, view.fatalityName, width / 2, height * 0.34, nameSize, "#f7768e", { spacing: 2 })
  let y = height * 0.34 + 24
  for (const line of lines) {
    label(ctx, line, width / 2, y, 13, "white", { bold: false })
    y += 18
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
