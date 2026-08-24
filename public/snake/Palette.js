// Themes.
//
// The Qt version reads Omarchy's active `colors.toml` and follows the desktop
// between dark and light. A browser has neither, so the palettes ship with the
// page and `prefers-color-scheme` picks the opening one. Everything else in the
// game reads these six names and nothing else, exactly as the desktop build
// does — no view hardcodes a dark-only surface.
//
//   background  the page and the frame around the board
//   playArea    the board itself, usually a shade deeper than the background
//   foreground  text, and the snake's head
//   accent      the snake's body, food, meters, buttons
//   muted       obstacles and secondary text
//   selection   currently unused by the board, kept for parity with the theme

export const themes = [
  {
    id: "tokyo-night",
    name: "Tokyo Night",
    dark: true,
    background: "#1a1b26",
    foreground: "#c0caf5",
    accent: "#7aa2f7",
    muted: "#565f89",
    selection: "#33467c",
    playArea: "#16161e"
  },
  {
    id: "catppuccin",
    name: "Catppuccin",
    dark: true,
    background: "#1e1e2e",
    foreground: "#cdd6f4",
    accent: "#89b4fa",
    muted: "#6c7086",
    selection: "#45475a",
    playArea: "#181825"
  },
  {
    id: "gruvbox",
    name: "Gruvbox",
    dark: true,
    background: "#282828",
    foreground: "#ebdbb2",
    accent: "#fabd2f",
    muted: "#928374",
    selection: "#3c3836",
    playArea: "#1d2021"
  },
  {
    id: "nord",
    name: "Nord",
    dark: true,
    background: "#2e3440",
    foreground: "#d8dee9",
    accent: "#88c0d0",
    muted: "#4c566a",
    selection: "#434c5e",
    playArea: "#292e39"
  },
  {
    id: "everforest",
    name: "Everforest",
    dark: true,
    background: "#2d353b",
    foreground: "#d3c6aa",
    accent: "#a7c080",
    muted: "#859289",
    selection: "#475258",
    playArea: "#272e33"
  },
  {
    id: "rose-pine",
    name: "Rosé Pine",
    dark: true,
    background: "#191724",
    foreground: "#e0def4",
    accent: "#ebbcba",
    muted: "#6e6a86",
    selection: "#26233a",
    playArea: "#1f1d2e"
  },
  {
    id: "kanagawa",
    name: "Kanagawa",
    dark: true,
    background: "#1f1f28",
    foreground: "#dcd7ba",
    accent: "#7e9cd8",
    muted: "#727169",
    selection: "#2d4f67",
    playArea: "#16161d"
  },
  {
    id: "matte-black",
    name: "Matte Black",
    dark: true,
    background: "#121212",
    foreground: "#eaeaea",
    accent: "#bdae93",
    muted: "#5a5a5a",
    selection: "#2a2a2a",
    playArea: "#0a0a0a"
  },
  {
    id: "catppuccin-latte",
    name: "Catppuccin Latte",
    dark: false,
    background: "#eff1f5",
    foreground: "#4c4f69",
    accent: "#1e66f5",
    muted: "#8c8fa1",
    selection: "#ccd0da",
    playArea: "#e6e9ef"
  },
  {
    id: "everforest-light",
    name: "Everforest Light",
    dark: false,
    background: "#fdf6e3",
    foreground: "#5c6a72",
    accent: "#8da101",
    muted: "#939f91",
    selection: "#edeada",
    playArea: "#f4f0d9"
  }
]

export const DEFAULT_DARK = "tokyo-night"
export const DEFAULT_LIGHT = "catppuccin-latte"

export const themeById = id => themes.find(theme => theme.id === id) || null

// The desktop follows the system; so does the first load here. After that the
// stored choice wins, because someone who pressed `t` meant it.
export function preferredTheme(stored) {
  const chosen = themeById(stored)
  if (chosen) return chosen
  const prefersLight = typeof matchMedia === "function"
    && matchMedia("(prefers-color-scheme: light)").matches
  return themeById(prefersLight ? DEFAULT_LIGHT : DEFAULT_DARK)
}

export function nextTheme(current) {
  const index = themes.findIndex(theme => theme.id === current.id)
  return themes[(index + 1) % themes.length]
}

// --- colour helpers, ported from the QML ---

export function parseColor(value) {
  const hex = value.replace("#", "")
  const full = hex.length === 3 ? [...hex].map(c => c + c).join("") : hex
  return {
    r: parseInt(full.slice(0, 2), 16) / 255,
    g: parseInt(full.slice(2, 4), 16) / 255,
    b: parseInt(full.slice(4, 6), 16) / 255
  }
}

const channel = value => Math.round(Math.max(0, Math.min(1, value)) * 255)

export const rgba = (color, alpha = 1) =>
  `rgba(${channel(color.r)}, ${channel(color.g)}, ${channel(color.b)}, ${alpha})`

export function mixColors(base, tint, amount) {
  return {
    r: base.r + (tint.r - base.r) * amount,
    g: base.g + (tint.g - base.g) * amount,
    b: base.b + (tint.b - base.b) * amount
  }
}

// Qt.darker(color, factor) divides each channel. The progress-bar trough uses
// it, and on a light theme dividing makes the trough visible rather than
// invisible, which is why it is a divide and not a fixed grey.
export const darker = (color, factor) => ({
  r: color.r / factor,
  g: color.g / factor,
  b: color.b / factor
})

// A palette with every colour pre-parsed, so the render loop never parses hex.
export function resolve(theme) {
  return {
    ...theme,
    colors: {
      background: parseColor(theme.background),
      foreground: parseColor(theme.foreground),
      accent: parseColor(theme.accent),
      muted: parseColor(theme.muted),
      selection: parseColor(theme.selection),
      playArea: parseColor(theme.playArea)
    }
  }
}
