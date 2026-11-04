import type { FieldMappings, GeneratedResult } from "@/types/nodes"

/** One shot of a Shot Cuts result: seconds from the clip's first frame. */
export interface ShotCutsShot {
  readonly index: number
  readonly startSec: number
  readonly endSec: number
  readonly durationSec: number
  /** With frames on: the shot's first decoded frame (PNG). */
  readonly firstFrameUrl?: string
  /** With frames on: its last decoded frame — the one before the next cut, or the clip's last. */
  readonly lastFrameUrl?: string
}

/** A Shot Cuts job's `json` output. */
export interface ShotCutsResult {
  readonly shotCount: number
  /** Where each new shot starts: ascending, never 0, `[]` for one shot. */
  readonly cutsSec: readonly number[]
  readonly durationSec: number
  readonly shots: readonly ShotCutsShot[]
}

/** Shot Cuts: the node's data. Every field here is a node setting gen:skills documents. */
export type ShotCutsData = {
  [key: string]: unknown
  label: string
  fieldMappings: FieldMappings
  executionStatus?: "idle" | "running" | "completed" | "failed"
  errorMessage?: string
  currentJobProgress?: number
  /** Wired into the "in" input. */
  videoUrl?: string
  /** Also save every shot's first and last frame as images (default off; same price). */
  frames?: boolean
  /** The "json" output: the shot count, the cut times, the clip's length and every shot. */
  generatedJson?: ShotCutsResult
  /** The "firstFrames" output (frames on): each shot's first frame, in shot order. */
  generatedFirstFrames?: string[]
  /** The "lastFrames" output (frames on): each shot's last frame, in shot order. */
  generatedLastFrames?: string[]
  generatedResults?: readonly GeneratedResult[]
  activeResultIndex?: number
}

/** A Shot Cuts result read off the node (an object, or the JSON string a wire carried), or null. */
export function shotCutsResultOf(raw: unknown): ShotCutsResult | null {
  let v = raw
  if (typeof v === "string") {
    try {
      v = JSON.parse(v)
    } catch {
      return null
    }
  }
  if (!v || typeof v !== "object") return null
  const r = v as Partial<ShotCutsResult>
  if (typeof r.shotCount !== "number" || !Array.isArray(r.shots) || !Array.isArray(r.cutsSec) || typeof r.durationSec !== "number") return null
  return r as ShotCutsResult
}

/** Seconds as m:ss.mmm (h:mm:ss.mmm past an hour). */
export function formatShotTime(sec: number): string {
  const ms = Math.max(0, Math.round(sec * 1000))
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  const frac = String(ms % 1000).padStart(3, "0")
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m)
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}.${frac}`
}
