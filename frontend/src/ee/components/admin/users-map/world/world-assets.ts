import * as THREE from "three"
import type { AccountState } from "../map-model"

/**
 * Shared geometry, materials and screen textures for the office floor, made
 * once per world and disposed with it.
 */

export const ACCENT = 0x3b6fe0
export const BROWSER_TAB = 0xf2a33a
export const CABLE: Readonly<Record<"device" | "network", number>> = { device: 0x3d4a66, network: 0x5b8def }
export const SINGLE_HOODIES = [0x9fb4d9, 0xc7b8e6, 0xa8d5ba, 0xf0c8a0, 0xd9b8c4, 0xb5c7d3]

const SCREEN_HEX: Readonly<Record<AccountState, string>> = {
  granted: "#3fb36b",
  withheld: "#8d99b2",
  revoked: "#e0584f",
  blocked: "#8b6ad8",
  unclaimed: "#b7c1d6",
}
const SCREEN_MARK: Readonly<Record<AccountState, string>> = {
  granted: "+",
  withheld: "—",
  revoked: "×",
  blocked: "",
  unclaimed: "",
}
/** The progress bar's colour while an account generates. */
export const PROGRESS: Readonly<Record<AccountState, number>> = {
  granted: 0x5fd38a,
  withheld: 0xb7c1d6,
  revoked: 0xff7a70,
  blocked: 0xb59cff,
  unclaimed: 0xd5dbe6,
}

export interface Theme {
  readonly bg: number
  readonly ground: number
  readonly floor: number
  readonly wall: number
  readonly pot: number
  readonly desk: number
  readonly deskTop: number
  readonly chair: number
  readonly rug: number
  readonly mix: number
  readonly hemi: number
  readonly sun: number
  readonly exposure: number
  readonly env: number
}

export const THEMES: Readonly<Record<"light" | "dark", Theme>> = {
  light: { bg: 0xe9eef6, ground: 0xe4e9f3, floor: 0xf6f8fc, wall: 0xdde3ee, pot: 0xffffff, desk: 0xfafbfe, deskTop: 0xeef1f7, chair: 0x4a5266, rug: 0xffffff, mix: 0.07, hemi: 0.55, sun: 1.6, exposure: 1.0, env: 1 },
  dark: { bg: 0x0b0f17, ground: 0x0a0e15, floor: 0x121824, wall: 0x1a2130, pot: 0x2a3242, desk: 0x2a3344, deskTop: 0x1d2433, chair: 0x3a4255, rug: 0x151b27, mix: 0.06, hemi: 0.28, sun: 0.85, exposure: 0.95, env: 0.35 },
}

function canvasTexture(w: number, h: number, paint: (x: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement("canvas")
  c.width = w
  c.height = h
  const x = c.getContext("2d")
  if (x) paint(x)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

/** A dark app mock with a top bar in the state's colour. */
function screenTexture(state: AccountState): THREE.CanvasTexture {
  const col = SCREEN_HEX[state]
  return canvasTexture(292, 168, (x) => {
    x.fillStyle = "#121826"
    x.fillRect(0, 0, 292, 168)
    x.fillStyle = col
    x.fillRect(0, 0, 292, 22)
    x.fillStyle = "rgba(255,255,255,.85)"
    for (const i of [0, 1, 2]) {
      x.beginPath()
      x.arc(12 + i * 12, 11, 3.5, 0, 7)
      x.fill()
    }
    x.fillStyle = "#1d2536"
    x.fillRect(10, 32, 64, 126)
    x.fillStyle = col
    x.globalAlpha = 0.9
    x.fillRect(86, 34, 120, 14)
    x.globalAlpha = 1
    x.fillStyle = "#3a455c"
    ;[58, 74, 90].forEach((y, i) => x.fillRect(86, y, 190 - i * 40, 7))
    x.fillStyle = col
    x.globalAlpha = state === "withheld" ? 0.35 : 0.25
    x.fillRect(86, 110, 190, 46)
    x.globalAlpha = 1
    x.font = "700 22px system-ui"
    x.textAlign = "right"
    x.fillText(SCREEN_MARK[state], 268, 142)
  })
}

export function makeAssets() {
  const mat = (color: number, o: THREE.MeshStandardMaterialParameters = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...o })
  const geo = {
    bezel: new THREE.BoxGeometry(1.6, 0.98, 0.08),
    screen: new THREE.PlaneGeometry(1.46, 0.84),
    tab: new THREE.PlaneGeometry(1.46, 0.1),
    stand: new THREE.BoxGeometry(0.12, 0.3, 0.12),
    pole: new THREE.CylinderGeometry(0.05, 0.05, 1, 6),
    desk: new THREE.BoxGeometry(1.85, 1.0, 0.95),
    seat: new THREE.BoxGeometry(0.9, 0.14, 0.9),
    back: new THREE.BoxGeometry(0.9, 1.0, 0.14),
    chairPole: new THREE.CylinderGeometry(0.07, 0.07, 0.6, 8),
    chairBase: new THREE.CylinderGeometry(0.5, 0.5, 0.08, 16),
    torso: new THREE.CapsuleGeometry(0.34, 0.5, 4, 12),
    head: new THREE.SphereGeometry(0.28, 16, 12),
    progBg: new THREE.PlaneGeometry(1.2, 0.07),
    prog: new THREE.PlaneGeometry(1.2, 0.07).translate(0.6, 0, 0),
    tower: new THREE.BoxGeometry(0.55, 1.15, 1.05),
    led: new THREE.SphereGeometry(0.06, 8, 6),
    router: new THREE.BoxGeometry(0.9, 0.22, 0.6),
    routerStand: new THREE.BoxGeometry(0.5, 1.1, 0.5),
    antenna: new THREE.CylinderGeometry(0.03, 0.03, 0.6, 6),
    pot: new THREE.CylinderGeometry(0.8, 0.6, 1.1, 14),
    leaf: new THREE.SphereGeometry(1.3, 16, 12),
  }
  const mats = {
    bezel: mat(0x262c3a, { roughness: 0.5 }),
    desk: mat(THEMES.light.desk),
    deskTop: mat(THEMES.light.deskTop),
    chair: mat(THEMES.light.chair),
    hair: mat(0x2a2a33),
    hood: mat(0x353d52),
    stand: mat(0x8a93a6, { metalness: 0.4, roughness: 0.4 }),
    tower: mat(0x2d3446, { roughness: 0.5 }),
    router: mat(0xffffff),
    antenna: mat(0x262c3a),
    wall: mat(THEMES.light.wall),
    pot: mat(THEMES.light.pot),
    leaf: mat(0x8fd0a0),
    progBg: new THREE.MeshBasicMaterial({ color: 0x2a3346, toneMapped: false }),
    blueLed: new THREE.MeshBasicMaterial({ color: 0x5b8def }),
    greenLed: new THREE.MeshBasicMaterial({ color: 0x3fb36b }),
  }
  const screens = Object.fromEntries(
    (["granted", "withheld", "revoked", "blocked", "unclaimed"] as const).map((s) => [s, screenTexture(s)]),
  ) as Record<AccountState, THREE.CanvasTexture>
  const off = canvasTexture(292, 168, (x) => {
    const gr = x.createLinearGradient(0, 0, 292, 168)
    gr.addColorStop(0, "#0d1220")
    gr.addColorStop(0.55, "#151c2c")
    gr.addColorStop(1, "#0a0e18")
    x.fillStyle = gr
    x.fillRect(0, 0, 292, 168)
  })
  const tick = canvasTexture(64, 64, (x) => {
    x.fillStyle = "#fff"
    x.beginPath()
    x.roundRect(8, 8, 48, 48, 12)
    x.fill()
    x.fillStyle = "#121826"
    x.font = "700 36px system-ui"
    x.textAlign = "center"
    x.textBaseline = "middle"
    x.fillText("✓", 32, 35)
  })

  const liveScreens = makeLiveScreens()

  const dispose = () => {
    Object.values(geo).forEach((g) => g.dispose())
    Object.values(mats).forEach((m) => m.dispose())
    Object.values(screens).forEach((t) => t.dispose())
    off.dispose()
    tick.dispose()
    liveScreens.dispose()
  }
  return { mat, geo, mats, screens, off, tick, live: liveScreens.textureFor, tickLive: liveScreens.tick, dispose }
}

// ── Live screens ──────────────────────────────────────────────────────────
// A clustered account's screen is a session at work: a log that keeps
// scrolling, a job bar that keeps filling, a cursor that blinks. The frames
// are painted on a few shared canvases (three per state), so a floor of a
// hundred farm screens costs fifteen small repaints every ~90 ms, and each
// account is bound to one of the three by its id so neighbours never move in
// step. Nothing on a screen is the account's own data.

const LIVE_VARIANTS = 3
const LIVE_TICK_MS = 90
const LIVE_W = 292
const LIVE_H = 168
const LIVE_ROWS = 7
const LOG_LINES = [
  "POST /v1/generate-video  202",
  "job 7f3a… queued · seedance-2.5",
  "upload reference.png  1.2 MB",
  "render 8s · 720p · 16:9",
  "GET /v1/jobs/7f3a…  processing",
  "credits reserved  1386",
  "prompt: short drama, ep. 12",
  "retry 2/3 · provider busy",
  "download output.mp4",
  "POST /v1/claim-signup-grant",
  "session resumed · tab 4",
  "waiting for worker…",
]

interface LiveScreen {
  readonly tex: THREE.CanvasTexture
  readonly ctx: CanvasRenderingContext2D | null
  readonly col: string
  readonly seed: number
  lines: string[]
  /** 0..1, the job bar; wraps. */
  bar: number
  /** Ticks until the next log line. */
  wait: number
}

function makeLiveScreens() {
  const all: LiveScreen[] = []
  const byState = new Map<AccountState, LiveScreen[]>()
  for (const state of ["granted", "withheld", "revoked", "blocked", "unclaimed"] as const) {
    const set: LiveScreen[] = []
    for (let v = 0; v < LIVE_VARIANTS; v++) {
      const c = document.createElement("canvas")
      c.width = LIVE_W
      c.height = LIVE_H
      const tex = new THREE.CanvasTexture(c)
      tex.colorSpace = THREE.SRGBColorSpace
      tex.anisotropy = 4
      const seed = v * 7 + state.length
      const s: LiveScreen = {
        tex,
        ctx: c.getContext("2d"),
        col: SCREEN_HEX[state],
        seed,
        lines: Array.from({ length: LIVE_ROWS }, (_, i) => LOG_LINES[(seed + i * 5) % LOG_LINES.length]!),
        bar: (seed % 10) / 10,
        wait: (seed % 5) + 2,
      }
      set.push(s)
      all.push(s)
    }
    byState.set(state, set)
  }
  let last = 0
  let frame = 0

  function paint(s: LiveScreen, blink: boolean) {
    const x = s.ctx
    if (!x) return
    x.fillStyle = "#0e1320"
    x.fillRect(0, 0, LIVE_W, LIVE_H)
    x.fillStyle = s.col
    x.fillRect(0, 0, LIVE_W, 22)
    x.fillStyle = "rgba(255,255,255,.85)"
    for (const i of [0, 1, 2]) {
      x.beginPath()
      x.arc(12 + i * 12, 11, 3.5, 0, 7)
      x.fill()
    }
    x.font = "500 12px ui-monospace, Menlo, Consolas, monospace"
    x.textAlign = "left"
    x.textBaseline = "alphabetic"
    s.lines.forEach((line, i) => {
      const lastRow = i === s.lines.length - 1
      x.fillStyle = lastRow ? s.col : i < 2 ? "#4a566e" : "#8a96ad"
      x.fillText(line, 12, 44 + i * 16)
    })
    if (blink) {
      x.fillStyle = s.col
      x.fillRect(14 + x.measureText(s.lines[s.lines.length - 1]!).width, 44 + (s.lines.length - 1) * 16 - 11, 7, 13)
    }
    x.fillStyle = "#1d2536"
    x.fillRect(12, LIVE_H - 16, LIVE_W - 24, 6)
    x.fillStyle = s.col
    x.fillRect(12, LIVE_H - 16, (LIVE_W - 24) * s.bar, 6)
    s.tex.needsUpdate = true
  }

  function tick(now: number) {
    if (now - last < LIVE_TICK_MS) return
    last = now
    frame++
    const blink = frame % 8 < 5
    for (const s of all) {
      s.bar += 0.012 + (s.seed % 3) * 0.004
      if (s.bar >= 1) s.bar = 0
      if (--s.wait <= 0) {
        s.wait = 3 + ((s.seed + frame) % 6)
        s.lines = [...s.lines.slice(1), LOG_LINES[(s.seed + frame) % LOG_LINES.length]!]
      }
      paint(s, blink)
    }
  }

  /** The screen bound to this account: one of the state's variants, fixed by the id. */
  function textureFor(state: AccountState, id: string): THREE.CanvasTexture {
    const set = byState.get(state) ?? byState.get("withheld")!
    let h = 0
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
    return set[h % set.length]!.tex
  }

  for (const s of all) paint(s, true)
  return { textureFor, tick, dispose: () => all.forEach((s) => s.tex.dispose()) }
}

export type Assets = ReturnType<typeof makeAssets>
