/**
 * Where a Clip Pack clip comes from in the recording (decided 2026-11-17): read
 * off the plan clip it renders — an EDL whose segments are on the recording's
 * (master) clock. Pure.
 *
 * - `sourceStartMs` / `sourceEndMs`: the earliest kept stretch's start and the
 *   latest one's end — the same bounds as the clip's key (`edlSpanKey`).
 * - `sourceSpans`: the stretches sorted by start, touching or overlapping ones
 *   merged; reported only when two or more remain.
 *
 * A clip on an output clock, or with no stretch that has a length, reports
 * nothing. Nothing is clamped, so for any edit that renders (every stretch
 * starts at 0 or later and has a length) the start and end are the clip key's
 * own bounds; the key alone also counts a stretch with no length.
 */
import { normalizeEdl } from "@nodaro/shared/edl"
import type { ClipPackClip, UseCaseSourceSpan } from "@nodaro/shared/edl"
import { isRecord } from "./wrapper-output-parts.js"

export type ClipSourcePlace = Pick<ClipPackClip, "sourceStartMs" | "sourceEndMs" | "sourceSpans">

/** A JSON value or its string form; a string that does not parse is nothing. */
export function parsedJson(raw: unknown): unknown {
  if (typeof raw !== "string") return raw
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

/** The stretches of an edit on the recording's clock, in the order it plays; [] for anything else. */
export function masterClockSpans(raw: unknown): UseCaseSourceSpan[] {
  const value = parsedJson(raw)
  if (!isRecord(value) || !Array.isArray(value.segments)) return []
  const edl = normalizeEdl(value)
  if (edl.clock !== "master") return []
  return edl.segments.flatMap((s) => (s.inMs >= 0 && s.outMs > s.inMs ? [{ inMs: s.inMs, outMs: s.outMs }] : []))
}

/** Sorted by start, a stretch that touches or overlaps the one before it merged into it. */
function mergedSpans(spans: readonly UseCaseSourceSpan[]): UseCaseSourceSpan[] {
  const sorted = [...spans].sort((a, b) => a.inMs - b.inMs || a.outMs - b.outMs)
  return sorted.reduce<UseCaseSourceSpan[]>((out, s) => {
    const last = out[out.length - 1]
    if (last && s.inMs <= last.outMs) return [...out.slice(0, -1), { inMs: last.inMs, outMs: Math.max(last.outMs, s.outMs) }]
    return [...out, s]
  }, [])
}

/** A plan clip's place in the recording (see the module note); undefined when it has none. */
export function clipSourceSpans(clip: unknown): ClipSourcePlace | undefined {
  const spans = mergedSpans(masterClockSpans(clip))
  if (spans.length === 0) return undefined
  return {
    sourceStartMs: spans[0]!.inMs,
    sourceEndMs: Math.max(...spans.map((s) => s.outMs)),
    ...(spans.length > 1 ? { sourceSpans: spans } : {}),
  }
}
