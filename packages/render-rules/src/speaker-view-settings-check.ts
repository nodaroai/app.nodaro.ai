/**
 * The settings half of Speaker View's rule: which ids and values the renderer
 * draws. Mirrors the plugin's `assertSpeakerViewDrawable` and the shape its
 * route's Zod holds a request to, so a setting it would refuse is named HERE,
 * before a run.
 */
import { getSpeakerLayout, getSpeakerSwitch, isKnownSpeakerEmphasisStyle, type Edl } from "@nodaro/shared"
import {
  SPEAKER_VIEW_ACCENT_PATTERN,
  SPEAKER_VIEW_LAYOUT_SETTINGS,
  isSpeakerViewAspect,
} from "./speaker-view-settings.js"

/** The settings as the plugin's route takes them (the wire shape). */
export interface SpeakerViewSettings {
  readonly layout?: unknown
  readonly switch?: { readonly type?: unknown; readonly durationMs?: unknown } | null
  readonly emphasis?: { readonly style?: unknown; readonly durationMs?: unknown } | null
  readonly accentColor?: unknown
  readonly speakerRegions?: unknown
  readonly targetAspect?: unknown
}

/** The longest tween the route accepts, in milliseconds. */
export const SPEAKER_VIEW_MAX_TWEEN_MS = 5_000

/** A switch the renderer draws: `cut`, `pan`, `zoom`, or a real crossfade. */
export function isSpeakerViewSwitchDrawn(type: unknown): boolean {
  if (typeof type !== "string") return false
  if (type === "cut" || type === "pan" || type === "zoom") return true
  return type.startsWith("xfade:") && getSpeakerSwitch(type)?.overlaps === true
}

const durationOk = (ms: unknown) => ms === undefined || (typeof ms === "number" && Number.isInteger(ms) && ms >= 0 && ms <= SPEAKER_VIEW_MAX_TWEEN_MS)

export interface SpeakerViewSettingProblem {
  readonly message: string
  /** The plugin's refusal code: an id it does not draw is `unsupported_setting`; a malformed duration is `invalid_edl`. */
  readonly refusal: "unsupported_setting" | "invalid_edl"
}

/** Why the settings, or a segment's own layout, cannot be drawn — one problem
 *  each, naming the id. */
export function speakerViewSettingProblems(edl: Edl, settings: SpeakerViewSettings): SpeakerViewSettingProblem[] {
  const out: SpeakerViewSettingProblem[] = []
  const unsupported = (message: string) => out.push({ message, refusal: "unsupported_setting" })
  const quote = (v: unknown) => (typeof v === "string" ? `"${v}"` : JSON.stringify(v) ?? String(v))
  if (settings.targetAspect !== undefined && !isSpeakerViewAspect(settings.targetAspect)) {
    unsupported(`aspect ${quote(settings.targetAspect)} is not drawn (16:9, 9:16, 1:1 or 4:5).`)
  }
  if (settings.layout !== undefined && !(typeof settings.layout === "string" && SPEAKER_VIEW_LAYOUT_SETTINGS.includes(settings.layout))) {
    unsupported(`layout ${quote(settings.layout)} is not drawn by this version — it draws ${SPEAKER_VIEW_LAYOUT_SETTINGS.map((id) => `"${id}"`).join(", ")}.`)
  }
  if (settings.switch && !isSpeakerViewSwitchDrawn(settings.switch.type)) {
    unsupported(`switch ${quote(settings.switch.type)} is not drawn by this version — it draws "cut", "pan", "zoom" or "xfade:<id>" (a combine-videos transition).`)
  }
  if (settings.emphasis && !(typeof settings.emphasis.style === "string" && isKnownSpeakerEmphasisStyle(settings.emphasis.style))) {
    unsupported(`emphasis ${quote(settings.emphasis.style)} is not drawn by this version — it draws "scale", "border" and "dim" (joined with "+"), or "none".`)
  }
  if (!durationOk(settings.switch?.durationMs) || !durationOk(settings.emphasis?.durationMs)) {
    out.push({ message: `a switch or emphasis duration must be a whole number of milliseconds from 0 to ${SPEAKER_VIEW_MAX_TWEEN_MS}.`, refusal: "invalid_edl" })
  }
  if (settings.accentColor !== undefined && !(typeof settings.accentColor === "string" && SPEAKER_VIEW_ACCENT_PATTERN.test(settings.accentColor))) {
    unsupported(`accent colour ${quote(settings.accentColor)} is not a "#RRGGBB" colour.`)
  }
  for (const seg of edl.segments) {
    const layout = seg.layout
    if (!layout) continue
    if (!getSpeakerLayout(layout.mode)) unsupported(`segment "${seg.id}" laid out as "${String(layout.mode)}" is not drawn by this version.`)
    if (layout.transition && !isSpeakerViewSwitchDrawn(layout.transition.type)) unsupported(`segment "${seg.id}"'s switch "${layout.transition.type}" is not drawn by this version.`)
    if (layout.emphasis && !isKnownSpeakerEmphasisStyle(layout.emphasis.style)) unsupported(`segment "${seg.id}"'s emphasis "${layout.emphasis.style}" is not drawn by this version.`)
  }
  return out
}
