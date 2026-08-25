// The bosses: who they are, how they are drawn, and how they can be finished.
//
// A boss fight replaces the ninth level of every set — after all eight
// obstacle layouts have been seen and before they start again faster and
// tighter. It is a duel: both snakes hunt each other's tail, and the boss is
// beaten one segment at a time until only its head is left.

// Portraits are drawn rather than loaded. Six of them as image files would be
// most of the page's weight, and these have to work in ten themes without
// looking pasted on — so each is a handful of shapes in the boss's own colours.
export const bosses = [
  {
    id: "null-pointer",
    name: "NULL POINTER",
    epithet: "Dereferences the undeserving.",
    skin: "#7aa2f7",
    dark: "#2b3a5c",
    eyes: "slit",
    pattern: "chevrons",
    crown: "none"
  },
  {
    id: "segfault",
    name: "SEGFAULT",
    epithet: "Reads what it was never given.",
    skin: "#f7768e",
    dark: "#5c2530",
    eyes: "cross",
    pattern: "shards",
    crown: "fangs"
  },
  {
    id: "deadlock",
    name: "DEADLOCK",
    epithet: "Waits for you to go first. Forever.",
    skin: "#bb9af7",
    dark: "#3c2f5c",
    eyes: "round",
    pattern: "bands",
    crown: "horns"
  },
  {
    id: "stack-overflow",
    name: "STACK OVERFLOW",
    epithet: "Recurses until something gives.",
    skin: "#e0af68",
    dark: "#5c4423",
    eyes: "slit",
    pattern: "shards",
    crown: "horns"
  },
  {
    id: "race-condition",
    name: "RACE CONDITION",
    epithet: "Arrives before it left.",
    skin: "#9ece6a",
    dark: "#33471f",
    eyes: "round",
    pattern: "chevrons",
    crown: "fangs"
  },
  {
    id: "memory-leak",
    name: "MEMORY LEAK",
    epithet: "Takes a little more each time.",
    skin: "#73daca",
    dark: "#1f4a45",
    eyes: "cross",
    pattern: "bands",
    crown: "none"
  }
]

export const bossFor = number => bosses[(Math.max(1, number) - 1) % bosses.length]

// The combinations, and what each one does to a snake that has run out of
// body. Matched against the last inputs, so a fumbled start is not fatal —
// only the tail of the sequence has to be right.
export const FATALITIES = [
  {
    keys: ["up", "up", "down", "down"],
    name: "KERNEL PANIC",
    flavour: "It stopped responding, then it just stopped."
  },
  {
    keys: ["left", "right", "left", "right"],
    name: "MERGE CONFLICT",
    flavour: "Both versions were kept. Neither survived."
  },
  {
    keys: ["down", "down", "up", "up"],
    name: "GARBAGE COLLECTED",
    flavour: "No live references remained."
  },
  {
    keys: ["left", "left", "right", "right"],
    name: "STACK UNWOUND",
    flavour: "Every frame popped, in order, politely."
  },
  {
    keys: ["up", "down", "left", "right"],
    name: "FORCE PUSHED",
    flavour: "History was rewritten. Its history."
  }
]

// Running out of time is a finish too. It is simply a worse one.
export const MERCY = {
  name: "MERCY",
  flavour: "You hesitated. It has been logged."
}

// --- portraits ---------------------------------------------------------------

// Draws one boss head-on, filling a box of `size` at (x, y). Everything is
// relative to `size`, so the same call works for the splash card and for a
// thumbnail beside the health bar.
export function drawPortrait(ctx, boss, x, y, size) {
  const unit = size / 100
  const px = value => x + value * unit
  const py = value => y + value * unit

  ctx.save()

  // The hood: a broad wedge, narrower at the jaw than at the brow.
  ctx.beginPath()
  ctx.moveTo(px(50), py(8))
  ctx.bezierCurveTo(px(92), py(14), px(96), py(52), px(78), py(74))
  ctx.bezierCurveTo(px(66), py(90), px(34), py(90), px(22), py(74))
  ctx.bezierCurveTo(px(4), py(52), px(8), py(14), px(50), py(8))
  ctx.closePath()
  ctx.fillStyle = boss.skin
  ctx.fill()

  // A darker snout, so the face reads as a face at thumbnail size.
  ctx.beginPath()
  ctx.moveTo(px(50), py(46))
  ctx.bezierCurveTo(px(68), py(52), px(70), py(72), px(50), py(84))
  ctx.bezierCurveTo(px(30), py(72), px(32), py(52), px(50), py(46))
  ctx.closePath()
  ctx.fillStyle = boss.dark
  ctx.fill()

  drawPattern(ctx, boss, px, py, unit)
  drawCrown(ctx, boss, px, py)
  drawEyes(ctx, boss, px, py, unit)

  // Nostrils and a forked tongue.
  ctx.fillStyle = boss.skin
  ctx.beginPath()
  ctx.ellipse(px(44), py(62), 2 * unit, 3 * unit, 0, 0, Math.PI * 2)
  ctx.ellipse(px(56), py(62), 2 * unit, 3 * unit, 0, 0, Math.PI * 2)
  ctx.fill()

  ctx.strokeStyle = "#f7768e"
  ctx.lineWidth = 2.4 * unit
  ctx.lineCap = "round"
  ctx.beginPath()
  ctx.moveTo(px(50), py(84))
  ctx.lineTo(px(50), py(94))
  ctx.moveTo(px(50), py(94))
  ctx.lineTo(px(44), py(100))
  ctx.moveTo(px(50), py(94))
  ctx.lineTo(px(56), py(100))
  ctx.stroke()

  ctx.restore()
}

function drawPattern(ctx, boss, px, py, unit) {
  ctx.fillStyle = boss.dark
  ctx.globalAlpha = 0.55
  if (boss.pattern === "chevrons") {
    for (let i = 0; i < 3; ++i) {
      const top = 18 + i * 11
      ctx.beginPath()
      ctx.moveTo(px(50), py(top))
      ctx.lineTo(px(66), py(top + 9))
      ctx.lineTo(px(50), py(top + 6))
      ctx.lineTo(px(34), py(top + 9))
      ctx.closePath()
      ctx.fill()
    }
  } else if (boss.pattern === "bands") {
    for (let i = 0; i < 3; ++i) {
      ctx.beginPath()
      ctx.ellipse(px(50), py(24 + i * 10), (26 - i * 4) * unit, 3.2 * unit, 0, 0, Math.PI * 2)
      ctx.fill()
    }
  } else {
    for (const [ox, oy] of [[30, 22], [70, 22], [26, 40], [74, 40]]) {
      ctx.beginPath()
      ctx.moveTo(px(ox), py(oy - 6))
      ctx.lineTo(px(ox + 6), py(oy))
      ctx.lineTo(px(ox), py(oy + 6))
      ctx.lineTo(px(ox - 6), py(oy))
      ctx.closePath()
      ctx.fill()
    }
  }
  ctx.globalAlpha = 1
}

function drawCrown(ctx, boss, px, py) {
  if (boss.crown === "none") return
  ctx.fillStyle = boss.dark
  if (boss.crown === "horns") {
    ctx.beginPath()
    ctx.moveTo(px(26), py(16))
    ctx.lineTo(px(12), py(-4))
    ctx.lineTo(px(36), py(8))
    ctx.closePath()
    ctx.moveTo(px(74), py(16))
    ctx.lineTo(px(88), py(-4))
    ctx.lineTo(px(64), py(8))
    ctx.closePath()
    ctx.fill()
    return
  }
  // Fangs, hanging below the snout.
  ctx.beginPath()
  ctx.moveTo(px(40), py(76))
  ctx.lineTo(px(43), py(94))
  ctx.lineTo(px(46), py(76))
  ctx.closePath()
  ctx.moveTo(px(60), py(76))
  ctx.lineTo(px(57), py(94))
  ctx.lineTo(px(54), py(76))
  ctx.closePath()
  ctx.fillStyle = "#ffffff"
  ctx.fill()
}

function drawEyes(ctx, boss, px, py, unit) {
  const eye = (cx, sign) => {
    ctx.fillStyle = "#f7e8a0"
    ctx.beginPath()
    ctx.ellipse(px(cx), py(40), 10 * unit, 7 * unit, 0, 0, Math.PI * 2)
    ctx.fill()

    ctx.fillStyle = "#101014"
    if (boss.eyes === "round") {
      ctx.beginPath()
      ctx.arc(px(cx), py(40), 4.2 * unit, 0, Math.PI * 2)
      ctx.fill()
    } else if (boss.eyes === "cross") {
      ctx.lineWidth = 2.6 * unit
      ctx.strokeStyle = "#101014"
      ctx.beginPath()
      ctx.moveTo(px(cx - 5), py(35))
      ctx.lineTo(px(cx + 5), py(45))
      ctx.moveTo(px(cx + 5), py(35))
      ctx.lineTo(px(cx - 5), py(45))
      ctx.stroke()
    } else {
      ctx.beginPath()
      ctx.ellipse(px(cx), py(40), 2 * unit, 6.5 * unit, 0, 0, Math.PI * 2)
      ctx.fill()
    }

    // A brow, angled inwards. Boss snakes are never pleased to see anybody.
    ctx.strokeStyle = boss.dark
    ctx.lineWidth = 3.4 * unit
    ctx.lineCap = "round"
    ctx.beginPath()
    ctx.moveTo(px(cx - sign * 11), py(28))
    ctx.lineTo(px(cx + sign * 9), py(34))
    ctx.stroke()
  }
  eye(33, 1)
  eye(67, -1)
}
