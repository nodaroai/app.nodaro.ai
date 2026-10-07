/**
 * Speaker View's reasons, in words (SV2, SV3, SV23): the rule hands the panel a
 * code and its numbers (`SpeakerViewReason`); this turns it into one localized
 * sentence. A greyed tile says WHY, never just "unavailable".
 */
import type { SpeakerViewNormalizeNote, SpeakerViewReason } from "@nodaro/render-rules"
import { SPEAKER_LAYOUT_LABEL_KEYS } from "@/components/nodes/speaker-view-quick-configs"
import type { MessageKey } from "@/lib/i18n"

export const SPEAKER_EMPHASIS_LABEL_KEYS: Readonly<Record<string, MessageKey>> = {
  scale: "speakerView.emphasis.scale",
  border: "speakerView.emphasis.border",
  dim: "speakerView.emphasis.dim",
}

type T = (key: MessageKey, vars?: Record<string, string | number>) => string

const layoutName = (id: unknown, t: T): string => {
  const key = typeof id === "string" ? SPEAKER_LAYOUT_LABEL_KEYS[id] : undefined
  return key ? t(key) : String(id ?? "")
}

/** One reason as a sentence; in a clip pack it names the clip (SV23). */
export function speakerViewReasonText(reason: SpeakerViewReason, t: T): string {
  const p = reason.params
  const layout = layoutName(p.layout, t)
  let text: string
  switch (reason.code) {
    case "aspect-not-drawn":
      text = t("speakerView.reason.aspectNotDrawn", { layout, aspect: String(p.aspect ?? "") })
      break
    case "too-many-speakers":
      text = t("speakerView.reason.tooMany", { layout, max: Number(p.max), count: Number(p.count) })
      break
    case "too-few-speakers":
      text = t("speakerView.reason.tooFew", { layout, min: Number(p.min), count: Number(p.count) })
      break
    case "single-shows-one":
      text = t("speakerView.reason.singleShowsOne")
      break
    case "swap-is-emphasis":
      text = t("speakerView.reason.swapIsEmphasis")
      break
    case "slots-fixed":
      text = t("speakerView.reason.slotsFixed", { layout })
      break
    case "no-same-camera-change":
      text = t("speakerView.reason.noSameCamera", { changes: Number(p.changes) })
      break
  }
  return typeof p.clip === "number" ? t("speakerView.reason.clip", { clip: p.clip, reason: text }) : text
}

/** "Side by side isn't drawn for 9:16 — renders as Stacked." */
export function speakerViewSnapText(note: SpeakerViewNormalizeNote, t: T): string {
  const vars = { from: layoutName(note.from, t), aspect: note.aspect, to: layoutName(note.to, t) }
  return t(note.because === "aspect" ? "speakerView.snappedAspect" : "speakerView.snappedSpeakers", vars)
}
