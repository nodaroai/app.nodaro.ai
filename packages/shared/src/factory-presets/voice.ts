import type { FactoryPreset } from "./types.js"

export const TEXT_TO_SPEECH_PRESETS: readonly FactoryPreset[] = [
  // ── Narration ────────────────────────────────────────────────────────────
  {
    id: "text-to-speech/narrator-calm",
    name: "Calm Narrator",
    description: "Even, measured narration.",
    group: "Narration",
    data: { speed: 1, stability: 0.6, similarityBoost: 0.75, style: 0 },
  },
  {
    id: "text-to-speech/audiobook",
    name: "Audiobook",
    description: "Warm, steady, slightly slower.",
    group: "Narration",
    data: { speed: 0.95, stability: 0.75, similarityBoost: 0.8, style: 0.1 },
  },
  {
    id: "text-to-speech/documentary",
    name: "Documentary",
    description: "Measured delivery with gravitas.",
    group: "Narration",
    data: { speed: 0.95, stability: 0.78, similarityBoost: 0.85, style: 0.25 },
  },
  {
    id: "text-to-speech/news-anchor",
    name: "News Anchor",
    description: "Neutral, authoritative, even pace.",
    group: "Narration",
    data: { speed: 1, stability: 0.7, similarityBoost: 0.8, style: 0.2 },
  },
  {
    id: "text-to-speech/explainer",
    name: "Explainer / Tutorial",
    description: "Clear, friendly, mid-pace.",
    group: "Narration",
    data: { speed: 1, stability: 0.55, similarityBoost: 0.75, style: 0.3 },
  },

  // ── Advertising & Hype ───────────────────────────────────────────────────
  {
    id: "text-to-speech/commercial",
    name: "Commercial Read",
    description: "Energetic, persuasive, punchy.",
    group: "Advertising & Hype",
    data: { speed: 1.05, stability: 0.48, similarityBoost: 0.75, style: 0.6 },
  },
  {
    id: "text-to-speech/hype",
    name: "Hype / High-Energy",
    description: "Fast, excited, dynamic.",
    group: "Advertising & Hype",
    data: { speed: 1.15, stability: 0.25, similarityBoost: 0.7, style: 0.8 },
  },

  // ── Conversational & Calm ────────────────────────────────────────────────
  {
    id: "text-to-speech/podcast-host",
    name: "Podcast Host",
    description: "Natural, casual, conversational.",
    group: "Conversational & Calm",
    data: { speed: 1.05, stability: 0.45, similarityBoost: 0.75, style: 0.4 },
  },
  {
    id: "text-to-speech/character",
    name: "Character / Storyteller",
    description: "Expressive, dramatic range.",
    group: "Conversational & Calm",
    data: { speed: 1, stability: 0.3, similarityBoost: 0.7, style: 0.7 },
  },
  {
    id: "text-to-speech/meditation",
    name: "Meditation / ASMR",
    description: "Very slow, soft, soothing.",
    group: "Conversational & Calm",
    data: { speed: 0.8, stability: 0.85, similarityBoost: 0.75, style: 0 },
  },
]

export const VOICE_DESIGN_PRESETS: readonly FactoryPreset[] = [
  // ── Narration & Character ────────────────────────────────────────────────
  {
    id: "voice-design/trailer-narrator",
    name: "Movie-Trailer Narrator",
    description: "Deep, dramatic, commanding.",
    group: "Narration & Character",
    data: { voiceDescription: "A deep, powerful male movie-trailer narrator with dramatic gravitas and a slow, commanding delivery." },
  },
  {
    id: "voice-design/audiobook-female",
    name: "Warm Female Audiobook",
    description: "Soothing, clear, intimate.",
    group: "Narration & Character",
    data: { voiceDescription: "A warm, soothing female audiobook narrator with clear articulation and a gentle, intimate tone." },
  },
  {
    id: "voice-design/old-wizard",
    name: "Old Wizard",
    description: "Gravelly, wise, theatrical.",
    group: "Narration & Character",
    data: { voiceDescription: "A gravelly, wise old wizard with a deep raspy voice and a slow, theatrical cadence." },
  },
  {
    id: "voice-design/noir-detective",
    name: "Noir Detective",
    description: "Raspy, smoky, brooding.",
    group: "Narration & Character",
    data: { voiceDescription: "A raspy, world-weary noir detective with a low, smoky, brooding voice." },
  },
  {
    id: "voice-design/meditation-guide",
    name: "Meditation Guide",
    description: "Calm, soft, breathy.",
    group: "Narration & Character",
    data: { voiceDescription: "A calm, soft-spoken meditation guide with a slow, breathy, reassuring delivery." },
  },

  // ── Professional & Assistant ─────────────────────────────────────────────
  {
    id: "voice-design/hype-announcer",
    name: "Energetic Hype",
    description: "Fast, excited, punchy.",
    group: "Professional & Assistant",
    data: { voiceDescription: "An energetic young hype announcer: fast-paced, excited and punchy." },
  },
  {
    id: "voice-design/friendly-assistant",
    name: "Friendly Assistant",
    description: "Bright, clear, approachable.",
    group: "Professional & Assistant",
    data: { voiceDescription: "A bright, friendly, professional virtual-assistant voice, clear and approachable." },
  },
  {
    id: "voice-design/corporate-ivr",
    name: "Corporate IVR",
    description: "Neutral, articulate, pro.",
    group: "Professional & Assistant",
    data: { voiceDescription: "A neutral, clear corporate phone-system voice, articulate and professional." },
  },
]

export const VOICE_CHANGER_PRESETS: readonly FactoryPreset[] = [
  {
    id: "voice-changer/faithful",
    name: "Faithful (Natural)",
    description: "Preserves original delivery.",
    group: "Revoice Styles",
    data: { stability: 0.4, similarityBoost: 0.85, style: 0, removeBackgroundNoise: false },
  },
  {
    id: "voice-changer/clean-stable",
    name: "Clean & Stable",
    description: "Smooth, consistent, denoised.",
    group: "Revoice Styles",
    data: { stability: 0.8, similarityBoost: 0.8, style: 0, removeBackgroundNoise: true },
  },
  {
    id: "voice-changer/expressive",
    name: "Expressive",
    description: "Amplifies the delivery.",
    group: "Revoice Styles",
    data: { stability: 0.3, similarityBoost: 0.7, style: 0.45, removeBackgroundNoise: false },
  },
  {
    id: "voice-changer/studio-clean",
    name: "Studio Clean",
    description: "Broadcast-ready, denoised.",
    group: "Revoice Styles",
    data: { stability: 0.65, similarityBoost: 0.85, style: 0, removeBackgroundNoise: true },
  },
]
