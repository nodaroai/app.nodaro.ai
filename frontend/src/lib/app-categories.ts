import { createElement, type ReactNode } from "react"
import { ImageIcon, Video, AudioLines, FileText } from "lucide-react"
import type { MessageKey, TFunction } from "@/lib/i18n"

// Each entry carries its own i18n `labelKey` so the localized name lives with
// the category/output-type definition — the single source of truth. Adding a
// new category is ONE edit here; the `satisfies` clause fails the build if a
// labelKey isn't a real message key. (Previously ~9 files each kept a private
// slug→key map with a `?? "cat.other"` fallback that silently hid a missed one.)
export const APP_CATEGORIES = [
  { value: "image-generation", label: "Image Generation", labelKey: "cat.imageGeneration" },
  { value: "video-production", label: "Video Production", labelKey: "cat.videoProduction" },
  { value: "audio-music", label: "Audio & Music", labelKey: "cat.audioMusic" },
  { value: "content-writing", label: "Content & Writing", labelKey: "cat.contentWriting" },
  { value: "social-media", label: "Social Media", labelKey: "cat.socialMedia" },
  { value: "data-processing", label: "Data Processing", labelKey: "cat.dataProcessing" },
  { value: "multi-step", label: "Multi-Step Pipeline", labelKey: "cat.multiStep" },
  { value: "other", label: "Other", labelKey: "cat.other" },
] as const satisfies ReadonlyArray<{ value: string; label: string; labelKey: MessageKey }>

export type AppCategory = (typeof APP_CATEGORIES)[number]["value"]

export const OUTPUT_TYPES = [
  { value: "image", label: "Image", labelKey: "out.image" },
  { value: "video", label: "Video", labelKey: "out.video" },
  { value: "audio", label: "Audio", labelKey: "out.audio" },
  { value: "text", label: "Text", labelKey: "out.text" },
] as const satisfies ReadonlyArray<{ value: string; label: string; labelKey: MessageKey }>

export type OutputType = (typeof OUTPUT_TYPES)[number]["value"]

const CATEGORY_LABEL_KEYS: Record<string, MessageKey> = Object.fromEntries(
  APP_CATEGORIES.map((c) => [c.value, c.labelKey]),
)
const OUTPUT_TYPE_LABEL_KEYS: Record<string, MessageKey> = Object.fromEntries(
  OUTPUT_TYPES.map((o) => [o.value, o.labelKey]),
)

/** i18n key for a category label; unknown values fall back to "cat.other". */
export function getCategoryLabelKey(value: string): MessageKey {
  return CATEGORY_LABEL_KEYS[value] ?? "cat.other"
}
/** Localized category label (unknown → "Other"). */
export function categoryLabel(value: string, t: TFunction): string {
  return t(getCategoryLabelKey(value))
}
/** i18n key for an output-type label; unknown values return undefined. */
export function getOutputTypeLabelKey(value: string): MessageKey | undefined {
  return OUTPUT_TYPE_LABEL_KEYS[value]
}
/** Localized output-type label; unknown values render their raw string. */
export function outputTypeLabel(value: string, t: TFunction): string {
  const key = getOutputTypeLabelKey(value)
  return key ? t(key) : value
}

/** Color coding for output type badges */
export const OUTPUT_TYPE_COLORS: Record<string, string> = {
  image: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  video: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  audio: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  text: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
}

/** Lucide icons for each output/handle media type (small, `w-3 h-3`). */
export const OUTPUT_TYPE_ICON: Record<string, ReactNode> = {
  image: createElement(ImageIcon, { className: "w-3 h-3" }),
  video: createElement(Video, { className: "w-3 h-3" }),
  audio: createElement(AudioLines, { className: "w-3 h-3" }),
  text: createElement(FileText, { className: "w-3 h-3" }),
}

/** Color coding for category badges */
export const CATEGORY_COLORS: Record<string, string> = {
  "image-generation": "bg-blue-500/10 text-blue-500",
  "video-production": "bg-purple-500/10 text-purple-500",
  "audio-music": "bg-amber-500/10 text-amber-500",
  "content-writing": "bg-emerald-500/10 text-emerald-500",
  "social-media": "bg-pink-500/10 text-pink-500",
  "data-processing": "bg-cyan-500/10 text-cyan-500",
  "multi-step": "bg-indigo-500/10 text-indigo-500",
  "other": "bg-zinc-500/10 text-zinc-500",
}
