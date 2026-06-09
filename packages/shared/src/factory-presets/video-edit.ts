import type { FactoryPreset } from "./types.js"

export const VIDEO_TO_VIDEO_PRESETS: readonly FactoryPreset[] = [
  {
    id: "video-to-video/anime",
    name: "Anime Restyle",
    description: "2D cel-shaded anime look.",
    group: "Restyle Looks",
    data: { provider: "wan", prompt: "Restyle this video as a 2D cel-shaded anime: vibrant colors, clean linework, expressive cel shading. Preserve the original motion, composition, and timing.", negativePrompt: "photorealistic, blurry, distorted, flickering" },
  },
  {
    id: "video-to-video/claymation",
    name: "Claymation",
    description: "Tactile stop-motion clay.",
    group: "Restyle Looks",
    data: { provider: "wan", prompt: "Restyle as tactile stop-motion claymation with plasticine textures and subtle fingerprints. Keep the original motion and framing.", negativePrompt: "photorealistic, smooth, flickering" },
  },
  {
    id: "video-to-video/cyberpunk-neon",
    name: "Cyberpunk Neon",
    description: "Rain-slicked neon city look.",
    group: "Restyle Looks",
    data: { provider: "wan", prompt: "Restyle with a neon cyberpunk aesthetic: rain-slicked surfaces, glowing magenta and cyan lighting, moody atmosphere. Preserve the original motion.", negativePrompt: "daylight, flat lighting, blurry, distorted" },
  },
  {
    id: "video-to-video/oil-painting",
    name: "Oil Painting",
    description: "Moving painterly brushwork.",
    group: "Restyle Looks",
    data: { provider: "wan", prompt: "Restyle as a moving oil painting with visible brushstrokes, rich impasto texture, and painterly color. Keep the original motion and composition.", negativePrompt: "photorealistic, flat, blurry, flickering" },
  },
  {
    id: "video-to-video/pixar-3d",
    name: "3D Animated",
    description: "Polished CG film look.",
    group: "Restyle Looks",
    data: { provider: "wan", prompt: "Restyle as a polished 3D animated film: soft global illumination, expressive characters, clean stylized surfaces. Preserve the original motion and timing.", negativePrompt: "photorealistic, lowres, distorted, flickering" },
  },
  {
    id: "video-to-video/watercolor",
    name: "Watercolor",
    description: "Flowing washes on paper.",
    group: "Restyle Looks",
    data: { provider: "wan", prompt: "Restyle as a flowing watercolor animation with soft washes, bleeding edges, and visible paper texture. Keep the original motion and composition.", negativePrompt: "photorealistic, harsh edges, blurry, flickering" },
  },
]

export const ADD_CAPTIONS_PRESETS: readonly FactoryPreset[] = [
  {
    id: "add-captions/clean-subtitles",
    name: "Clean Subtitles",
    description: "Classic bottom subtitles.",
    group: "Caption Styles",
    data: { style: "subtitle", position: "bottom", fontSize: 32, color: "#FFFFFF", autoTranscribe: true },
  },
  {
    id: "add-captions/tiktok-bold",
    name: "TikTok Bold",
    description: "Big centered word-by-word.",
    group: "Caption Styles",
    data: { style: "tiktok-words", position: "center", fontSize: 72, color: "#FFFFFF", autoTranscribe: true },
  },
  {
    id: "add-captions/karaoke",
    name: "Karaoke Highlight",
    description: "Words fill as spoken.",
    group: "Caption Styles",
    data: { style: "karaoke", position: "bottom", fontSize: 56, color: "#FFFFFF", autoTranscribe: true },
  },
  {
    id: "add-captions/word-pop",
    name: "Word Pop",
    description: "Each word pops in.",
    group: "Caption Styles",
    data: { style: "word-pop", position: "center", fontSize: 64, color: "#FFE600", autoTranscribe: true },
  },
  {
    id: "add-captions/bouncy",
    name: "Bouncy Captions",
    description: "Energetic bouncing words.",
    group: "Caption Styles",
    data: { style: "bouncy", position: "bottom", fontSize: 64, color: "#FFFFFF", autoTranscribe: true },
  },
  {
    id: "add-captions/word-highlight",
    name: "Word Highlight",
    description: "Active word highlighted.",
    group: "Caption Styles",
    data: { style: "word-highlight", position: "bottom", fontSize: 48, color: "#00E5FF", autoTranscribe: true },
  },
  {
    id: "add-captions/top-banner",
    name: "Top Banner",
    description: "Subtitles along the top.",
    group: "Caption Styles",
    data: { style: "subtitle", position: "top", fontSize: 36, color: "#FFFFFF", autoTranscribe: true },
  },
]

export const COMBINE_VIDEOS_PRESETS: readonly FactoryPreset[] = [
  {
    id: "combine-videos/seamless-join",
    name: "Seamless Join (One-Shot)",
    description: "Jump-free join for scene-extension / start-end-frame clips.",
    group: "Joins & Transitions",
    data: { transition: "cut", transitionDuration: 0.5, audioMode: "crossfade", audioCrossfadeCurve: "equal-power", trimEndFrames: 4, trimStartFrames: 3 },
  },
  {
    id: "combine-videos/hard-cut",
    name: "Hard Cut",
    description: "Instant switch, no blend. Fastest.",
    group: "Joins & Transitions",
    data: { transition: "cut", audioMode: "keep", trimStartFrames: 0, trimEndFrames: 0 },
  },
  {
    id: "combine-videos/crossfade",
    name: "Crossfade",
    description: "Smooth alpha cross-fade between clips.",
    group: "Joins & Transitions",
    data: { transition: "fade", transitionDuration: 0.7, audioMode: "crossfade", audioCrossfadeCurve: "equal-power" },
  },
  {
    id: "combine-videos/dissolve",
    name: "Dissolve",
    description: "Grainy organic blend for memory beats.",
    group: "Joins & Transitions",
    data: { transition: "dissolve", transitionDuration: 1, audioMode: "crossfade", audioCrossfadeCurve: "equal-power" },
  },
  {
    id: "combine-videos/fade-through-black",
    name: "Fade Through Black",
    description: "Dip to black between scenes.",
    group: "Joins & Transitions",
    data: { transition: "dip-to-black", transitionDuration: 1, audioMode: "crossfade", audioCrossfadeCurve: "equal-power" },
  },
]
