/**
 * What the badge of a Speaker View node judges an EDL by (C3.2): the plugin's
 * own refusals, mirrored in `@nodaro/render-rules` (`findSpeakerViewIssues`) —
 * the very code the server's ingresses refuse with — so the badge never passes
 * what the run refuses, or the other way round. What the render does
 * differently from the EDL (the late-camera snap) shows as the badge's notes.
 *
 * One render, one EDL: a list is not one.
 */
import { findSpeakerViewIssues, speakerViewContext, speakerViewWireSettings, type SpeakerViewNodeSettings } from "@nodaro/render-rules"
import type { EdlValidity } from "@/lib/edl-validity"

/** The EDL a Speaker View render reads and what it renders with. */
export interface SpeakerViewJudgeInput {
  /** The EDL value (an object or its JSON string). */
  readonly edl: unknown
  /** The wired transcript, if any (Speaker View reads its speakers). */
  readonly transcript?: unknown
  /** The node's own data (its settings). */
  readonly settings: Readonly<Record<string, unknown>>
}

const isBlank = (v: unknown): boolean => v === undefined || v === null || (typeof v === "string" && !v.trim())

const parse = (v: unknown): { ok: true; value: unknown } | { ok: false } => {
  if (typeof v !== "string") return { ok: true, value: v }
  try { return { ok: true, value: JSON.parse(v) } } catch { return { ok: false } }
}

/** Speaker View: the plugin's refusals, mirrored (`findSpeakerViewIssues`), and
 *  the notes of what the render does differently, as the badge's warnings. */
export function speakerViewValidity(input: SpeakerViewJudgeInput): EdlValidity | null {
  if (isBlank(input.edl)) return null
  const parsed = parse(input.edl)
  if (!parsed.ok) return { kind: "edl", ok: false, issues: [], warnings: [], unparseable: true }
  if (Array.isArray(parsed.value)) return { kind: "edl", ok: false, issues: ["expected one EDL, got a list"], warnings: [] }
  const parsedTranscript = isBlank(input.transcript) ? undefined : parse(input.transcript)
  const transcript = parsedTranscript?.ok ? parsedTranscript.value : undefined
  const settings = speakerViewWireSettings(input.settings as SpeakerViewNodeSettings, speakerViewContext(parsed.value, transcript))
  const verdict = findSpeakerViewIssues({ edl: parsed.value, transcript, settings })
  return { kind: "edl", ok: verdict.ok, issues: verdict.issues.map((i) => i.message), warnings: verdict.notes }
}

/** A clip pack (Camera Switch in clips mode, one EDL per clip): every clip is
 *  judged, and each issue and note names its clip (SV23). One EDL is judged as
 *  itself; none is `null` ("wire an EDL"). */
export function speakerViewBatchValidity(
  edls: readonly unknown[],
  transcript: unknown,
  settings: Readonly<Record<string, unknown>>,
): EdlValidity | null {
  const held = edls.filter((e) => !isBlank(e))
  if (held.length === 0) return null
  if (held.length === 1) return speakerViewValidity({ edl: held[0], transcript, settings })
  const verdicts = held.map((edl) => speakerViewValidity({ edl, transcript, settings }))
  const name = (i: number, m: string) => `clip[${i}]: ${m}`
  const issues = verdicts.flatMap((v, i) => (v?.unparseable ? [name(i, "not valid JSON")] : (v?.issues ?? []).map((m) => name(i, m))))
  const warnings = verdicts.flatMap((v, i) => (v?.warnings ?? []).map((m) => name(i, m)))
  return { kind: "clips", ok: issues.length === 0, issues, warnings }
}
