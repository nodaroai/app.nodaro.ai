import { createElement, type ReactNode } from "react"
import { ImageIcon, Video, AudioLines, FileText } from "lucide-react"

export const APP_CATEGORIES = [
  { value: "image-generation", label: "Image Generation" },
  { value: "video-production", label: "Video Production" },
  { value: "audio-music", label: "Audio & Music" },
  { value: "content-writing", label: "Content & Writing" },
  { value: "social-media", label: "Social Media" },
  { value: "data-processing", label: "Data Processing" },
  { value: "multi-step", label: "Multi-Step Pipeline" },
  { value: "other", label: "Other" },
] as const

export type AppCategory = (typeof APP_CATEGORIES)[number]["value"]

export const OUTPUT_TYPES = [
  { value: "image", label: "Image" },
  { value: "video", label: "Video" },
  { value: "audio", label: "Audio" },
  { value: "text", label: "Text" },
] as const

export type OutputType = (typeof OUTPUT_TYPES)[number]["value"]

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
