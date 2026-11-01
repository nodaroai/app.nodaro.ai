// What a preview run keeps of a trend's stored scene description (decided
// 2026-11-01): there is one text, the whole clip's, and a preview run sends
// it with the whole clip's window; the engine cuts it to the 4 s it runs and
// re-times it to 0–4 s. This mirrors the engine's own cut (its `retimeSceneText`,
// `textCoverage`, `rewriteWindow`), so the admin can read what a preview
// keeps: the shot lines that overlap the window, cut to it and re-based to 0
// (whole seconds: the start floored, the end ceiled; a shot list's: tenths),
// every other line (the setting, the people) where it was. Pure; read only.

/** A window in seconds. */
export interface SceneWindow {
  fromSec: number
  toSec: number
}

/** A preview's length (seconds). */
export const PREVIEW_SECONDS = 4
/** Windows this close (each end, in seconds) are the same window for a whole-second text… */
const SCENE_WINDOW_TOLERANCE_SEC = 0.5
/** …and this close for a shot list, whose times are tenths. */
const SHOT_LIST_WINDOW_TOLERANCE_SEC = 0.05
/** A text whose shots run this far past its window's length covers more than the window. */
const COVERAGE_SLACK_SEC = 1.5

/** A shot line in whole seconds: "0-2s: …", "- 3–5 s: …". */
const SHOT_LINE_RE = /^(\s*(?:[-•*]\s*)?)(\d+)\s*[-–]\s*(\d+)\s*s\s*:/
/** A shot list's line, in tenths and brackets: "[1.2-3.4 s] wide; …". */
const BRACKET_SHOT_LINE_RE = /^(\s*(?:[-•*]\s*)?)\[\s*(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)\s*s?\s*\]/

/** A shot line read: its prefix (a bullet), its range, the rest, and whether it is a shot list's (bracketed, tenths). */
export interface ShotLine {
  prefix: string
  from: number
  to: number
  rest: string
  bracket: boolean
}

const tenths = (n: number) => (Math.round(n * 10) / 10).toFixed(1)

/** A line's shot range, in either format; null when it is not a shot line. */
export function shotLineOf(line: string): ShotLine | null {
  const b = BRACKET_SHOT_LINE_RE.exec(line)
  if (b) return { prefix: b[1]!, from: Number(b[2]), to: Number(b[3]), rest: line.slice(b[0].length), bracket: true }
  const m = SHOT_LINE_RE.exec(line)
  return m ? { prefix: m[1]!, from: Number(m[2]), to: Number(m[3]), rest: line.slice(m[0].length), bracket: false } : null
}

const hasShotListLines = (text: string): boolean => text.split("\n").some((l) => shotLineOf(l)?.bracket === true)

/** The latest shot end a text's shot lines name (its own seconds), or null when it has none. */
export function lastShotEnd(text: string): number | null {
  let end: number | null = null
  for (const line of text.split("\n")) {
    const shot = shotLineOf(line)
    if (shot) end = Math.max(end ?? 0, shot.to)
  }
  return end
}

/**
 * The stretch of the source a text covers, from the window it is sent with:
 * that window, unless its own shots run well past its length, when it is the
 * whole clip's (0 to its last shot).
 */
export function textCoverage(text: string, given: SceneWindow): SceneWindow {
  const end = lastShotEnd(text)
  if (end !== null && end > given.toSec - given.fromSec + COVERAGE_SLACK_SEC) return { fromSec: 0, toSec: Math.max(end, given.toSec) }
  return given
}

/**
 * The stretch of a text to keep, in the TEXT's own seconds (its 0 is
 * `textWindow.fromSec`), when the window wanted (`runWindow`, source seconds)
 * differs from the one the text covers; null when they are the same.
 */
export function rewriteWindow(textWindow: SceneWindow, runWindow: SceneWindow, tolerance: number = SCENE_WINDOW_TOLERANCE_SEC): SceneWindow | null {
  const same = Math.abs(textWindow.fromSec - runWindow.fromSec) <= tolerance && Math.abs(textWindow.toSec - runWindow.toSec) <= tolerance
  if (same) return null
  const length = textWindow.toSec - textWindow.fromSec
  const fromSec = Math.min(length, Math.max(0, runWindow.fromSec - textWindow.fromSec))
  const toSec = Math.min(length, Math.max(fromSec, runWindow.toSec - textWindow.fromSec))
  return { fromSec, toSec }
}

/**
 * A text re-timed to `window` (its own seconds): the shot lines that overlap
 * it, cut to it and re-based to start at 0, each in its own format; every
 * other line as it is. Null when the text has no shot line to re-time.
 */
export function retimeSceneText(text: string, window: SceneWindow): string | null {
  const lines = text.split("\n")
  if (!lines.some((l) => shotLineOf(l) !== null)) return null
  const end = Math.ceil(window.toSec - window.fromSec)
  const out = lines.flatMap((line) => {
    const shot = shotLineOf(line)
    if (!shot) return [line]
    const { from: a, to: b } = shot
    if (b <= window.fromSec || a >= window.toSec) return []
    if (shot.bracket) {
      const length = Math.round((window.toSec - window.fromSec) * 10) / 10
      const from = Math.max(0, Math.round((Math.max(a, window.fromSec) - window.fromSec) * 10) / 10)
      const to = Math.min(length, Math.round((Math.min(b, window.toSec) - window.fromSec) * 10) / 10)
      return to > from ? [`${shot.prefix}[${tenths(from)}-${tenths(to)} s]${shot.rest}`] : []
    }
    const from = Math.max(0, Math.floor(Math.max(a, window.fromSec) - window.fromSec))
    const to = Math.min(end, Math.max(from + 1, Math.ceil(Math.min(b, window.toSec) - window.fromSec)))
    return [`${shot.prefix}${from}-${to}s:${shot.rest}`]
  })
  return out.join("\n").trim()
}

/**
 * What a preview run keeps of the whole clip's text, as the engine cuts it:
 * the run sends the text with the stretch it covers (the whole clip, 0 to
 * `durationSec`), and the engine cuts it to the 4 s it runs (`previewStart`
 * to `previewStart` + 4 s) and re-times it. A text with no shot line, or a
 * clip that is the preview's window already, is kept as it is. With no known
 * length, the text's own last shot (or the preview's end) stands for it.
 */
export function previewCut(full: string, previewStart: number, durationSec: number | undefined): string {
  const text = full.trim()
  const end = previewStart + PREVIEW_SECONDS
  const given = { fromSec: 0, toSec: durationSec ?? Math.max(lastShotEnd(text) ?? 0, end) }
  const runWindow = { fromSec: previewStart, toSec: end }
  const tolerance = hasShotListLines(text) ? SHOT_LIST_WINDOW_TOLERANCE_SEC : SCENE_WINDOW_TOLERANCE_SEC
  const window = rewriteWindow(textCoverage(text, given), runWindow, tolerance)
  return (window ? retimeSceneText(text, window) : null) ?? text
}
