export const STATUS_COLORS: Record<string, string> = {
  completed: "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400",
  failed: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400",
  running: "bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-400",
  pending: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400",
  cancelled: "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400",
  stopping: "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400",
  timed_out: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400",
}

export const TRIGGER_LABELS: Record<string, string> = {
  manual: "Manual",
  webhook: "Webhook",
  schedule: "Schedule",
  "single-node": "Single Node",
}

export function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSecs = Math.floor(diffMs / 1000)
  const diffMins = Math.floor(diffSecs / 60)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffSecs < 60) return "just now"
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString()
}

export function formatDuration(startedAt: string | undefined, completedAt: string | undefined): string {
  if (!startedAt) return "-"
  const start = new Date(startedAt).getTime()
  const end = completedAt ? new Date(completedAt).getTime() : Date.now()
  const seconds = (end - start) / 1000
  if (seconds < 1) return `${(seconds * 1000).toFixed(0)}ms`
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}m ${secs.toFixed(0)}s`
}

export const NODE_STATUS_DOT: Record<string, string> = {
  completed: "bg-green-500",
  failed: "bg-red-500",
  running: "bg-yellow-500 animate-pulse",
  pending: "bg-blue-400",
  skipped: "bg-gray-400",
}

export const JOB_TYPE_LABELS: Record<string, string> = {
  "generate-image": "Image Generation",
  "image-to-image": "Image to Image",
  "edit-image": "Image Editing",
  "image-to-video": "Image to Video",
  "text-to-video": "Text to Video",
  "video-to-video": "Video to Video",
  "text-to-speech": "Text to Speech",
  "text-to-dialogue": "Dialogue",
  "generate-music": "Music Generation",
  "text-to-audio": "Sound Effects",
  "generate-script": "Script Generation",
  "ai-writer": "AI Writer",
  "video-composer": "Video Composer",
  "after-effects": "After Effects",
  "lottie-overlay": "Lottie Overlay",
  "3d-title": "3D Title",
  "motion-graphics": "Motion Graphics",
  "render-video": "Video Render",
  "voice-clone": "Voice Clone",
  "voice-changer": "Voice Changer",
  "voice-design": "Voice Design",
  "voice-remix": "Voice Remix",
  "dubbing": "Dubbing",
  "forced-alignment": "Forced Alignment",
  "audio-isolation": "Audio Isolation",
  "lip-sync": "Lip Sync",
  "motion-transfer": "Motion Transfer",
  "video-upscale": "Video Upscale",
  "image-to-text": "Image to Text",
  "qa-check": "QA Check",
  "combine-videos": "Combine Videos",
  "merge-video-audio": "Merge Video+Audio",
  "add-captions": "Add Captions",
  "resize-video": "Resize Video",
  "trim-video": "Trim Video",
  "extract-audio": "Extract Audio",
  "speed-ramp": "Speed Ramp",
  "loop-video": "Loop Video",
  "fade-video": "Fade Video",
  "mix-audio": "Mix Audio",
  "adjust-volume": "Adjust Volume",
  "translate": "Translation",
}

export function formatNodeType(nodeType: string): string {
  return JOB_TYPE_LABELS[nodeType] ?? nodeType.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

export interface NodeState {
  status: string
  nodeType?: string
  jobId?: string
  creditsUsed?: number
  error?: string
  startedAt?: string
  completedAt?: string
}
