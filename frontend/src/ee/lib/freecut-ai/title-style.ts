/**
 * The text that comes onto the screen on the spoken words (a headline, a line
 * with its key words in color, a big number, a short list): what it says, how
 * it looks, where it sits and how it comes in, as the editor's own text item.
 * Pure; `run/titles.ts` sends it to the editor.
 */
import type { Rect } from "./speaker-layout"

export const TITLE_KINDS = ["headline", "words", "number", "list"] as const
export type TitleKind = (typeof TITLE_KINDS)[number]

/** One look for the whole video. */
export const TITLE_LOOKS = ["outline", "clean", "sticker"] as const
export type TitleLook = (typeof TITLE_LOOKS)[number]
export const DEFAULT_TITLE_LOOK: TitleLook = "outline"

export const TITLE_PLACES = ["top", "middle", "low"] as const
export type TitlePlace = (typeof TITLE_PLACES)[number]
export const DEFAULT_TITLE_PLACE: TitlePlace = "top"

export const TITLE_ENTRIES = ["pop", "rise", "type", "blur"] as const
export type TitleEntry = (typeof TITLE_ENTRIES)[number]

/** The colors a key word can take. */
export const TITLE_KEY_COLORS = ["#8FDC5C", "#FFD60A", "#FF0073", "#4CC9F0", "#FFFFFF"] as const

/** A text item's id, so the panel finds its texts on the timeline. */
export const TITLE_ID = /^ai-title-/
export const titleId = (stamp: string, n: number) => `ai-title-${stamp}-${n}`

/** What the panel knows about one text on the screen. */
export interface TitleRecord {
  /** The text item's id in the editor. */
  readonly id: string
  readonly kind: TitleKind
  /** What it says; a list's lines are separated by a line break. */
  readonly text: string
  /** The words of the text shown in the key color (a number's figure is always in it). */
  readonly key: string
  /** Under a number: what it counts. */
  readonly sub?: string
  readonly look: TitleLook
  readonly place: TitlePlace
  readonly entry: TitleEntry
  /** The key color, when the person chose one; else the look's own. */
  readonly color?: string
  /** The color of the other words, when the person chose one. */
  readonly textColor?: string
  /** The color behind the text when the person chose: a color, or null for none. Unset, the look decides. */
  readonly background?: string | null
  /** A list's lines come in this many seconds apart, as they are said. */
  readonly lineGap?: number
}

interface LookStyle {
  readonly color: string
  readonly key: string
  /** The color behind the text, for a look that has one. */
  readonly background?: string
  readonly style: (fontSize: number) => Record<string, unknown>
}

const LOOKS: Record<TitleLook, LookStyle> = {
  outline: { color: "#FFFFFF", key: "#8FDC5C", style: (fs) => ({ stroke: { width: Math.max(2, Math.round(fs * 0.09)), color: "#000000" } }) },
  clean: { color: "#FFFFFF", key: "#FFD60A", style: (fs) => ({ textShadow: { offsetX: 0, offsetY: Math.round(fs * 0.04), blur: Math.round(fs * 0.14), color: "#000000" } }) },
  sticker: { color: "#0B0B0C", key: "#FF0073", background: "#FFD60A", style: () => ({}) },
}

/** The key color a text shows: the person's, else its look's. */
export const keyColorOf = (record: Pick<TitleRecord, "look" | "color">) => record.color ?? LOOKS[record.look].key

/** The color of a text's other words: the person's, else its look's. */
export const textColorOf = (record: Pick<TitleRecord, "look" | "textColor">) => record.textColor ?? LOOKS[record.look].color

/** The color behind a text, or null for none: the person's choice, else its look's. */
export const backgroundOf = (record: Pick<TitleRecord, "look" | "background">): string | null => (record.background === undefined ? (LOOKS[record.look].background ?? null) : record.background)

/** The colors to start a choice from. */
export const TITLE_TEXT_COLORS = ["#FFFFFF", "#0B0B0C", "#FFD60A", "#FF0073", "#4CC9F0"] as const
export const TITLE_BACKGROUND_COLORS = ["#FFD60A", "#0B0B0C", "#FFFFFF", "#FF0073", "#3B5BDB"] as const

/** How each kind comes in unless the person chooses. */
export const DEFAULT_ENTRY: Record<TitleKind, TitleEntry> = { headline: "rise", words: "pop", number: "pop", list: "rise" }

const plain = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "")

/** The text as runs, each either in the key color or not: the key words are matched word by word. */
export function keyRuns(text: string, key: string): Array<{ readonly text: string; readonly key: boolean }> {
  const wanted = new Set(key.split(/\s+/).map(plain).filter(Boolean))
  const runs: Array<{ text: string; key: boolean }> = []
  for (const part of text.split(/(\s+)/)) {
    if (!part) continue
    const space = /^\s+$/.test(part)
    const last = runs[runs.length - 1]
    // A space stays with the run before it, so words keep their gaps where the color changes.
    if (space) {
      if (last) last.text += part
      continue
    }
    const isKey = wanted.has(plain(part))
    if (last && last.key === isKey) last.text += part
    else runs.push({ text: part, key: isKey })
  }
  return runs
}

const ENTRY_MOTION: Record<TitleEntry, { readonly presetId: string; readonly durationFrames: number; readonly staggerFrames: number; readonly easing: string }> = {
  pop: { presetId: "pop", durationFrames: 10, staggerFrames: 3, easing: "overshoot" },
  rise: { presetId: "rise", durationFrames: 14, staggerFrames: 4, easing: "ease-out" },
  type: { presetId: "typewriter", durationFrames: 1, staggerFrames: 2, easing: "linear" },
  blur: { presetId: "blur-in", durationFrames: 14, staggerFrames: 3, easing: "ease-out" },
}

/** The editor's motion for a text: how it comes in (a list, line by line as it is said), and a short fade out. */
export function titleMotion(record: Pick<TitleRecord, "kind" | "entry" | "lineGap">, fps: number): Record<string, unknown> {
  const scale = fps / 30
  const frames = (n: number) => Math.max(1, Math.round(n * scale))
  const m = ENTRY_MOTION[record.entry]
  const byLine = record.kind === "list"
  const base = { intensity: 1, order: "forward", seed: 0 }
  return {
    in: {
      ...base,
      presetId: m.presetId,
      durationFrames: frames(m.durationFrames),
      staggerFrames: byLine && record.lineGap ? Math.max(1, Math.round(Math.min(3, record.lineGap) * fps)) : frames(m.staggerFrames),
      easing: m.easing,
      ...(byLine ? { unit: "line" } : {}),
    },
    out: { ...base, presetId: "fade-down", durationFrames: frames(8), staggerFrames: 0, easing: "ease-in", unit: "whole-clip" },
  }
}

export interface Canvas {
  readonly width: number
  readonly height: number
}

/** The letters' size for a part of the frame: a tenth of its shorter side. */
export const titleFontSize = (zone: Rect) => Math.round(Math.min(zone.w, zone.h) * 0.1)

const linesOf = (record: Pick<TitleRecord, "kind" | "text" | "sub">) => (record.kind === "list" ? record.text.split("\n").filter((l) => l.trim()) : record.kind === "number" ? [record.text, ...(record.sub ? [record.sub] : [])] : [record.text])

/**
 * The text's box inside `zone` (the part of the frame where the speaker shows),
 * as the editor's transform (x and y from the canvas's center). With a color
 * behind it the box hugs the text, so the color does not fill the frame's width.
 */
export function titleBox(record: Pick<TitleRecord, "kind" | "text" | "sub" | "look" | "place" | "background">, zone: Rect, canvas: Canvas): { x: number; y: number; width: number; height: number } {
  const fs = titleFontSize(zone)
  const most = zone.w * 0.88
  let width = most
  let height = zone.h * 0.3
  if (backgroundOf(record)) {
    const pad = fs * 0.28 * 2
    const lines = linesOf(record)
    const big = record.kind === "number" ? 2.2 : 1
    const longest = Math.max(...lines.map((l, i) => l.length * fs * 0.6 * (i === 0 ? big : 1)))
    width = Math.min(most, longest + pad)
    const wrapped = lines.reduce((sum, l, i) => sum + Math.max(1, Math.ceil((l.length * fs * 0.6 * (i === 0 ? big : 1)) / (most - pad))) * (i === 0 ? big : 1), 0)
    height = Math.min(zone.h * 0.6, wrapped * fs * 1.2 + pad)
  }
  const top = record.place === "top" ? zone.y + zone.h * 0.06 : record.place === "middle" ? zone.y + (zone.h - height) / 2 : zone.y + zone.h * 0.74 - height
  return { x: Math.round(zone.x + zone.w / 2 - canvas.width / 2), y: Math.round(top + height / 2 - canvas.height / 2), width: Math.round(width), height: Math.round(height) }
}

/** Everything about the text item but its id, track and time: sent whole when it is laid, and again when it is changed. */
export function titleFields(record: Omit<TitleRecord, "id">, zone: Rect, canvas: Canvas, fps: number): Record<string, unknown> {
  const fs = titleFontSize(zone)
  const look = LOOKS[record.look]
  const key = keyColorOf(record)
  const ink = textColorOf(record)
  const behind = backgroundOf(record)
  const span = (text: string, color: string, fontSize = fs) => ({ text, color, fontSize, fontFamily: "Inter", fontWeight: "bold" })
  const spans =
    record.kind === "number"
      ? [span(record.text, key, Math.round(fs * 2.2)), ...(record.sub ? [span(record.sub, ink, Math.round(fs * 0.75))] : [])]
      : record.kind === "list"
        ? linesOf(record).map((line) => span(line, ink, Math.round(fs * 0.85)))
        : keyRuns(record.text, record.key).map((run) => span(run.text, run.key ? key : ink))
  const stacked = record.kind === "number" || record.kind === "list"
  return {
    type: "text",
    label: record.text.replace(/\n/g, " · ").slice(0, 60),
    text: linesOf(record).join("\n"),
    textSpans: spans,
    spanLayout: stacked ? "stack" : "inline",
    color: ink,
    fontSize: fs,
    fontFamily: "Inter",
    fontWeight: "bold",
    fontStyle: "normal",
    underline: false,
    letterSpacing: 0,
    lineHeight: 1.1,
    textAlign: "center",
    verticalAlign: behind ? "middle" : record.place === "top" ? "top" : record.place === "middle" ? "middle" : "bottom",
    // Every look's own fields are named, so a change of look clears the one before.
    stroke: undefined,
    textShadow: undefined,
    backgroundColor: undefined,
    backgroundRadius: undefined,
    textPadding: 0,
    ...look.style(fs),
    ...(behind ? { backgroundColor: behind, backgroundRadius: Math.round(fs * 0.2), textPadding: Math.round(fs * 0.28) } : {}),
    textMotion: titleMotion(record, fps),
    transform: { ...titleBox(record, zone, canvas), rotation: 0, opacity: 1 },
  }
}

/** How long a text stays: from two to four seconds on its words; a list, until a moment after its last line. */
export function titleSeconds(kind: TitleKind, start: number, until: number, lines = 1, lineGap = 0): number {
  if (kind === "list") return Math.min(8, Math.max(2.5, (lines - 1) * Math.min(3, lineGap) + 1.8))
  if (kind === "headline") return Math.min(4, Math.max(2.4, until - start))
  return Math.min(4, Math.max(2, until - start))
}

/** A text starts a breath before its words. */
export const TITLE_LEAD_SECONDS = 0.15
