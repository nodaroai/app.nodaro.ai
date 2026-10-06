/**
 * The 30 preset voices Gemini Omni's audio-persona endpoint accepts, with the
 * style labels its documentation gives each one. DATA, so the API docs, the MCP
 * tool text and any client picker list them from one place instead of copying a
 * table that drifts.
 *
 * A preset is the BASE voice; a persona is that voice plus a free-text
 * description (timbre, pace, emotion) and an example line. Pinning a persona to a
 * character is what keeps one voice across separate clips.
 */
export interface GeminiOmniVoicePreset {
  id: string
  gender: "female" | "male" | "genderless"
  /** The documented character of the voice ("soft", "raspy", "intellectual"…). */
  style: string
  /** The documented pitch band ("low", "mid-low", "mid", "mid-high", "high"; "younger" for fenrir). */
  pitch: string
}

export const GEMINI_OMNI_VOICE_PRESETS = [
  { id: "achernar", gender: "female", style: "soft", pitch: "high" },
  { id: "achird", gender: "male", style: "friendly", pitch: "mid" },
  { id: "algenib", gender: "male", style: "raspy", pitch: "low" },
  { id: "algieba", gender: "male", style: "easygoing", pitch: "mid-low" },
  { id: "alnilam", gender: "male", style: "steady", pitch: "mid-low" },
  { id: "aoede", gender: "female", style: "brisk", pitch: "mid" },
  { id: "autonoe", gender: "female", style: "bright", pitch: "mid" },
  { id: "callirrhoe", gender: "female", style: "easygoing", pitch: "mid" },
  { id: "charon", gender: "male", style: "intellectual", pitch: "low" },
  { id: "despina", gender: "female", style: "smooth", pitch: "mid" },
  { id: "enceladus", gender: "male", style: "breathy", pitch: "low" },
  { id: "erinome", gender: "female", style: "clear", pitch: "mid" },
  { id: "fenrir", gender: "male", style: "lively", pitch: "younger" },
  { id: "gacrux", gender: "female", style: "mature", pitch: "mid" },
  { id: "iapetus", gender: "male", style: "clear", pitch: "mid-low" },
  { id: "kore", gender: "female", style: "capable", pitch: "mid" },
  { id: "laomedeia", gender: "female", style: "cheerful", pitch: "mid-high" },
  { id: "leda", gender: "female", style: "young", pitch: "mid-high" },
  { id: "orus", gender: "male", style: "steady", pitch: "mid-low" },
  { id: "puck", gender: "male", style: "cheerful", pitch: "mid" },
  { id: "pulcherrima", gender: "genderless", style: "forward", pitch: "mid-high" },
  { id: "rasalgethi", gender: "male", style: "intellectual", pitch: "mid" },
  { id: "sadachbia", gender: "male", style: "vivid", pitch: "low" },
  { id: "sadaltager", gender: "male", style: "knowledgeable", pitch: "mid" },
  { id: "schedar", gender: "male", style: "smooth", pitch: "mid-low" },
  { id: "sulafat", gender: "female", style: "warm", pitch: "mid" },
  { id: "umbriel", gender: "male", style: "smooth", pitch: "low" },
  { id: "vindemiatrix", gender: "female", style: "gentle", pitch: "mid" },
  { id: "zephyr", gender: "female", style: "bright", pitch: "mid-high" },
  { id: "zubenelgenubi", gender: "male", style: "casual", pitch: "mid-low" },
] as const satisfies readonly GeminiOmniVoicePreset[]

export type GeminiOmniVoicePresetId = (typeof GEMINI_OMNI_VOICE_PRESETS)[number]["id"]

/** The preset ids as a non-empty tuple — what `z.enum(...)` takes. */
export const GEMINI_OMNI_VOICE_PRESET_IDS = GEMINI_OMNI_VOICE_PRESETS.map((v) => v.id) as unknown as readonly [
  GeminiOmniVoicePresetId,
  ...GeminiOmniVoicePresetId[],
]
