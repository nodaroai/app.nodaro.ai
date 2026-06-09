import type { FactoryPreset } from "./types.js"

export const TEXT_TO_AUDIO_PRESETS: readonly FactoryPreset[] = [
  // ── Transitions & Impacts ────────────────────────────────────────────────
  {
    id: "text-to-audio/whoosh",
    name: "Whoosh Transition",
    description: "Fast clean swoosh.",
    group: "Transitions & Impacts",
    data: { provider: "elevenlabs-sfx", duration: 1, promptInfluence: 0.7, prompt: "fast clean whoosh transition swoosh, smooth air movement" },
  },
  {
    id: "text-to-audio/impact-boom",
    name: "Impact / Boom",
    description: "Deep cinematic hit.",
    group: "Transitions & Impacts",
    data: { provider: "elevenlabs-sfx", duration: 2, promptInfluence: 0.7, prompt: "deep cinematic impact boom, powerful sub hit with tail" },
  },
  {
    id: "text-to-audio/riser",
    name: "Riser / Build-Up",
    description: "Rising tension sweep.",
    group: "Transitions & Impacts",
    data: { provider: "elevenlabs-sfx", duration: 4, promptInfluence: 0.6, prompt: "tension riser build-up sweep rising to a peak" },
  },

  // ── Ambiences (loopable) ─────────────────────────────────────────────────
  {
    id: "text-to-audio/rain-ambience",
    name: "Rain Ambience",
    description: "Steady gentle rain.",
    group: "Ambiences (loopable)",
    data: { provider: "elevenlabs-sfx", duration: 22, loop: true, promptInfluence: 0.4, prompt: "steady gentle rain ambience with distant soft thunder" },
  },
  {
    id: "text-to-audio/forest-ambience",
    name: "Forest Ambience",
    description: "Birds and rustling leaves.",
    group: "Ambiences (loopable)",
    data: { provider: "elevenlabs-sfx", duration: 22, loop: true, promptInfluence: 0.4, prompt: "calm forest ambience, birdsong, gentle wind through leaves" },
  },
  {
    id: "text-to-audio/fire-crackle",
    name: "Fire Crackle",
    description: "Cozy fireplace loop.",
    group: "Ambiences (loopable)",
    data: { provider: "elevenlabs-sfx", duration: 22, loop: true, promptInfluence: 0.4, prompt: "cozy fireplace crackling, warm popping embers" },
  },
  {
    id: "text-to-audio/scifi-drone",
    name: "Sci-Fi Drone",
    description: "Ominous ambient hum.",
    group: "Ambiences (loopable)",
    data: { provider: "elevenlabs-sfx", duration: 22, loop: true, promptInfluence: 0.5, prompt: "low sci-fi ambient drone, ominous spaceship hum" },
  },

  // ── UI & Stingers ────────────────────────────────────────────────────────
  {
    id: "text-to-audio/ui-click",
    name: "UI Click / Pop",
    description: "Crisp interface tap.",
    group: "UI & Stingers",
    data: { provider: "elevenlabs-sfx", duration: 1, promptInfluence: 0.8, prompt: "crisp UI click pop, clean modern interface tap" },
  },
  {
    id: "text-to-audio/notification",
    name: "Notification Chime",
    description: "Bright pleasant alert.",
    group: "UI & Stingers",
    data: { provider: "elevenlabs-sfx", duration: 2, promptInfluence: 0.8, prompt: "pleasant bright notification chime, short and clean" },
  },
  {
    id: "text-to-audio/applause",
    name: "Applause / Crowd",
    description: "Enthusiastic cheering.",
    group: "UI & Stingers",
    data: { provider: "elevenlabs-sfx", duration: 5, promptInfluence: 0.6, prompt: "enthusiastic crowd applause and cheering" },
  },
  // ── Foley & Action ───────────────────────────────────────────────────────
  {
    id: "text-to-audio/footsteps",
    name: "Footsteps",
    description: "Walking on a hard floor.",
    group: "Foley & Action",
    data: { provider: "elevenlabs-sfx", duration: 4, promptInfluence: 0.6, prompt: "footsteps walking on a hard wooden floor, steady pace" },
  },
  {
    id: "text-to-audio/door",
    name: "Door Open / Close",
    description: "Creak then shut.",
    group: "Foley & Action",
    data: { provider: "elevenlabs-sfx", duration: 3, promptInfluence: 0.7, prompt: "wooden door slowly creaking open then closing with a soft latch" },
  },
  {
    id: "text-to-audio/glass-break",
    name: "Glass Break",
    description: "Sharp shatter.",
    group: "Foley & Action",
    data: { provider: "elevenlabs-sfx", duration: 2, promptInfluence: 0.8, prompt: "glass shattering, sharp break with falling shards" },
  },
  {
    id: "text-to-audio/keyboard-typing",
    name: "Keyboard Typing",
    description: "Mechanical key clicks.",
    group: "Foley & Action",
    data: { provider: "elevenlabs-sfx", duration: 5, promptInfluence: 0.6, prompt: "fast mechanical keyboard typing, crisp key clicks" },
  },
  {
    id: "text-to-audio/explosion",
    name: "Explosion",
    description: "Deep boom + debris.",
    group: "Foley & Action",
    data: { provider: "elevenlabs-sfx", duration: 3, promptInfluence: 0.7, prompt: "large explosion, deep boom with rumbling debris and tail" },
  },
  {
    id: "text-to-audio/magic-sparkle",
    name: "Magic Sparkle",
    description: "Shimmering chime FX.",
    group: "Foley & Action",
    data: { provider: "elevenlabs-sfx", duration: 2, promptInfluence: 0.7, prompt: "magical sparkle shimmer, twinkling fairy-dust chimes" },
  },
  {
    id: "text-to-audio/camera-shutter",
    name: "Camera Shutter",
    description: "DSLR click.",
    group: "Foley & Action",
    data: { provider: "elevenlabs-sfx", duration: 1, promptInfluence: 0.8, prompt: "DSLR camera shutter click, single crisp photo snap" },
  },
  {
    id: "text-to-audio/error-buzzer",
    name: "Error Buzzer",
    description: "Wrong / fail tone.",
    group: "Foley & Action",
    data: { provider: "elevenlabs-sfx", duration: 1, promptInfluence: 0.8, prompt: "short error buzzer, negative fail tone" },
  },
]
