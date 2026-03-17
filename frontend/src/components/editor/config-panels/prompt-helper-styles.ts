export interface PromptStyle {
  readonly value: string
  readonly label: string
}

export const IMAGE_PROMPT_STYLES: readonly PromptStyle[] = [
  { value: "photorealistic", label: "Photorealistic" },
  { value: "cinematic", label: "Cinematic" },
  { value: "commercial-product", label: "Commercial / Product" },
  { value: "portrait-closeup", label: "Portrait Close-up" },
  { value: "aerial-drone", label: "Aerial / Drone" },
  { value: "macro", label: "Macro Close-up" },
  { value: "studio-lighting", label: "Studio Lighting" },
  { value: "anime", label: "Anime" },
  { value: "digital-art", label: "Digital Art" },
  { value: "oil-painting", label: "Oil Painting" },
  { value: "watercolor", label: "Watercolor" },
  { value: "3d-render", label: "3D Render" },
  { value: "pencil-sketch", label: "Pencil Sketch" },
  { value: "minimalist", label: "Minimalist" },
  { value: "fantasy", label: "Fantasy" },
  { value: "noir", label: "Noir" },
  { value: "retro-vintage", label: "Retro / Vintage" },
]

export const VIDEO_PROMPT_STYLES: readonly PromptStyle[] = [
  { value: "cinematic", label: "Cinematic" },
  { value: "documentary", label: "Documentary" },
  { value: "home-video", label: "Home Video" },
  { value: "commercial", label: "Commercial" },
  { value: "music-video", label: "Music Video" },
  { value: "slow-motion", label: "Slow Motion" },
  { value: "timelapse", label: "Timelapse" },
  { value: "action", label: "Action Sequence" },
  { value: "romantic", label: "Romantic" },
  { value: "horror", label: "Horror" },
  { value: "sci-fi", label: "Sci-Fi" },
  { value: "nature", label: "Nature / Wildlife" },
  { value: "animation", label: "Animation" },
]

export const MUSIC_PROMPT_STYLES: readonly PromptStyle[] = [
  { value: "cinematic-score", label: "Cinematic Score" },
  { value: "lo-fi", label: "Lo-fi" },
  { value: "ambient", label: "Ambient" },
  { value: "electronic", label: "Electronic" },
  { value: "orchestral", label: "Orchestral" },
  { value: "rock", label: "Rock" },
  { value: "jazz", label: "Jazz" },
  { value: "pop", label: "Pop" },
  { value: "hip-hop", label: "Hip-Hop" },
  { value: "dramatic", label: "Dramatic" },
  { value: "peaceful", label: "Peaceful" },
  { value: "upbeat", label: "Upbeat / Energetic" },
  { value: "dark-moody", label: "Dark / Moody" },
]

export const AUDIO_PROMPT_STYLES: readonly PromptStyle[] = [
  { value: "realistic", label: "Realistic" },
  { value: "stylized", label: "Stylized" },
  { value: "cartoon", label: "Cartoon" },
  { value: "sci-fi", label: "Sci-Fi" },
  { value: "fantasy", label: "Fantasy" },
  { value: "industrial", label: "Industrial" },
  { value: "nature", label: "Nature" },
  { value: "ui-notification", label: "UI / Notification" },
]

const NODE_TO_STYLES: Record<string, readonly PromptStyle[]> = {
  "generate-image": IMAGE_PROMPT_STYLES,
  "edit-image": IMAGE_PROMPT_STYLES,
  "image-to-image": IMAGE_PROMPT_STYLES,
  "text-to-video": VIDEO_PROMPT_STYLES,
  "image-to-video": VIDEO_PROMPT_STYLES,
  "video-to-video": VIDEO_PROMPT_STYLES,
  "speech-to-video": VIDEO_PROMPT_STYLES,
  "motion-transfer": VIDEO_PROMPT_STYLES,
  "extend-video": VIDEO_PROMPT_STYLES,
  "generate-music": MUSIC_PROMPT_STYLES,
  "suno-generate": MUSIC_PROMPT_STYLES,
  "text-to-audio": AUDIO_PROMPT_STYLES,
}

export function getStylesForNodeType(nodeType: string): readonly PromptStyle[] {
  return NODE_TO_STYLES[nodeType] ?? IMAGE_PROMPT_STYLES
}
