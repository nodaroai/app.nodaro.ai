export const COMPLEXITY_CONFIG = {
  simple: { label: "Simple", color: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20" },
  intermediate: { label: "Intermediate", color: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20" },
  advanced: { label: "Advanced", color: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20" },
} as const

export type Complexity = keyof typeof COMPLEXITY_CONFIG

const NODE_TYPE_LABELS: Record<string, string> = {
  "generate-image": "Image Generation",
  "edit-image": "Image Editing",
  "image-to-image": "Image to Image",
  "generate-video": "Video Generation",
  "image-to-video": "Image to Video",
  "text-to-video": "Text to Video",
  "video-to-video": "Video to Video",
  "text-to-speech": "Text to Speech",
  "generate-music": "Music Generation",
  "text-to-audio": "Sound Effects",
  "generate-script": "Script Generation",
  "ai-writer": "AI Writer",
  "llm-chat": "Generate Text",
  "scene": "Scene",
  "video-composer": "Video Composer",
  "after-effects": "After Effects",
  "motion-graphics": "Motion Graphics",
  "lottie-overlay": "Lottie Overlay",
  "3d-title": "3D Title",
  "combine-videos": "Combine Videos",
  "merge-video-audio": "Merge Video & Audio",
  "add-captions": "Add Captions",
  "resize-video": "Resize Video",
  "trim-video": "Trim Video",
  "trim-audio": "Trim Audio",
  "speed-ramp": "Speed Ramp",
  "loop-video": "Loop Video",
  "fade-video": "Fade Video",
  "mix-audio": "Mix Audio",
  "adjust-volume": "Adjust Volume",
  "transcribe": "Transcribe",
  "audio-isolation": "Audio Isolation",
  "text-to-dialogue": "Dialogue",
  "voice-changer": "Voice Changer",
  "dubbing": "Dubbing",
  "voice-remix": "Voice Remix",
  "voice-design": "Voice Design",
  "forced-alignment": "Forced Alignment",
  "lip-sync": "Lip Sync",
  "motion-transfer": "Motion Transfer",
  "video-upscale": "Upscale Video",
  "render-video": "Render Video",
  "text-prompt": "Text",
  "upload-image": "Upload Image",
  "upload-video": "Upload Video",
  "upload-audio": "Upload Audio",
  "character": "Character",
  "face": "Face",
  "object": "Object",
  "location": "Location",
  "composite": "Composite",
  "extend-video": "Extend Video",
  "social": "Social Media",
  "speech-to-video": "Speech to Video",
  "image-to-text": "Image to Text",
  "qa-check": "QA Check",
  "translate": "Translate",
  "sub-workflow": "Sub-Workflow",
  "webhook-trigger": "Webhook Trigger",
  "schedule-trigger": "Schedule Trigger",
  "preview": "Preview",
}

export function getNodeTypeLabel(type: string): string {
  return NODE_TYPE_LABELS[type] ?? type.split("-").map((w) => w[0]?.toUpperCase() + w.slice(1)).join(" ")
}

export function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}
