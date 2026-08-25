/**
 * Premade ElevenLabs voice catalog (leaf data module).
 *
 * Extracted from routes/voices.ts so BOTH routes and providers can import it
 * DOWNWARD without a route↔provider cycle (voices.ts already imports
 * registerVoiceLookup from providers/kie/audio.ts; Task 6/7/8 need the catalog
 * in providers too). Data + type only — no imports, no logic.
 *
 * Curated "premade" voice catalog (mirrors frontend/src/lib/tts-voices.ts) —
 * all text-to-speech requests route through the direct ElevenLabs API (never
 * KIE); voices accepted by name, plus Adam, Bella & Harry via their ElevenLabs
 * UUIDs.
 *
 * Previews + descriptions are baked in (#862): without a key this list IS the
 * picker, and a picker you cannot audition is the picker's core function
 * missing. The preview files are ElevenLabs' public premade CDN objects
 * (storage.googleapis.com/eleven-public-prod) — the API key is needed to LIST
 * them, never to PLAY them — so every install gets play + descriptions with no
 * key, no credits, no request at render time. Entries marked "retired
 * upstream" no longer exist in the ElevenLabs catalog (no preview to offer);
 * they stay because stored node data still references them by name, with the
 * descriptions the catalog carried for them.
 */
export interface ElevenLabsVoice {
  voice_id: string
  name: string
  preview_url: string
  gender: string
  accent: string
  age: string
  description: string
  use_case: string
  category: string
}

export const FALLBACK_VOICES: readonly ElevenLabsVoice[] = [
  // Female voices
  { voice_id: "Alice", name: "Alice", preview_url: "https://storage.googleapis.com/eleven-public-prod/premade/voices/Xb7hH8MSUJpSbSDYk0k2/d10f7534-11f6-41fe-a012-2de1e482d336.mp3", gender: "female", accent: "British", age: "middle_aged", description: "Clear and engaging, friendly woman with a British accent suitable for e-learning.", use_case: "informative_educational", category: "premade" },
  { voice_id: "Aria", name: "Aria", preview_url: "", /* retired upstream */ gender: "female", accent: "American", age: "young", description: "Expressive and sassy, with a youthful energy.", use_case: "social_media", category: "premade" },
  { voice_id: "hpp4J3VqNfWAUOO0d1Us", name: "Bella", preview_url: "https://storage.googleapis.com/eleven-public-prod/premade/voices/hpp4J3VqNfWAUOO0d1Us/dab0f5ba-3aa4-48a8-9fad-f138fea1126d.mp3", gender: "female", accent: "American", age: "middle_aged", description: "This voice is warm, bright, and professional, characterized by a Standard American accent and a polished, narrative quality. It features a medium-high pitch with crisp diction and a deliberate, rhythmic pace that makes it highly intelligible and engaging for long-form listening.", use_case: "informative_educational", category: "premade" },
  { voice_id: "Charlotte", name: "Charlotte", preview_url: "", /* retired upstream */ gender: "female", accent: "English-Swedish", age: "young", description: "Smooth, intimate and seductive — built for character work.", use_case: "characters_animation", category: "premade" },
  { voice_id: "Jessica", name: "Jessica", preview_url: "https://storage.googleapis.com/eleven-public-prod/premade/voices/cgSgspJ2msm6clMCkdW9/56a97bf8-b69b-448f-846c-c3a11683d45a.mp3", gender: "female", accent: "American", age: "young", description: "Young and popular, this playful American female voice is perfect for trendy content.", use_case: "conversational", category: "premade" },
  { voice_id: "Laura", name: "Laura", preview_url: "https://storage.googleapis.com/eleven-public-prod/premade/voices/FGY2WhTYpPnrIDTdsKH5/67341759-ad08-41a5-be6e-de12fe448618.mp3", gender: "female", accent: "American", age: "young", description: "This young adult female voice delivers sunny enthusiasm with a quirky attitude.", use_case: "social_media", category: "premade" },
  { voice_id: "Lily", name: "Lily", preview_url: "https://storage.googleapis.com/eleven-public-prod/premade/voices/pFZP5JQG7iQjIQuC4Bku/89b68b35-b3dd-4348-a84a-a3c13a3c2b30.mp3", gender: "female", accent: "British", age: "middle_aged", description: "Velvety British female voice delivers news and narrations with warmth and clarity.", use_case: "informative_educational", category: "premade" },
  { voice_id: "Matilda", name: "Matilda", preview_url: "https://storage.googleapis.com/eleven-public-prod/premade/voices/XrExE9yKIg1WjnnlVkGX/b930e18d-6b4d-466e-bab2-0ae97c6d8535.mp3", gender: "female", accent: "American", age: "middle_aged", description: "A professional woman with a pleasing alto pitch. Suitable for many use cases.", use_case: "informative_educational", category: "premade" },
  { voice_id: "Rachel", name: "Rachel", preview_url: "", /* retired upstream */ gender: "female", accent: "American", age: "young", description: "Calm, clear and reassuring — the default narrator.", use_case: "narrative_story", category: "premade" },
  { voice_id: "Sarah", name: "Sarah", preview_url: "https://storage.googleapis.com/eleven-public-prod/premade/voices/EXAVITQu4vr4xnSDxMaL/01a3e33c-6e99-4ee7-8543-ff2216a32186.mp3", gender: "female", accent: "American", age: "young", description: "Young adult woman with a confident and warm, mature quality and a reassuring, professional tone.", use_case: "entertainment_tv", category: "premade" },

  // Male voices
  { voice_id: "pNInz6obpgDQGcFmaJgB", name: "Adam", preview_url: "https://storage.googleapis.com/eleven-public-prod/premade/voices/pNInz6obpgDQGcFmaJgB/d6905d7a-dd26-4187-bfff-1bd3a5ea7cac.mp3", gender: "male", accent: "American", age: "middle_aged", description: "A bright tenor pitch that immediately cuts through. The delivery is brash and openly confident, speaking with unwavering certainty and a slightly aggressive self-assurance.", use_case: "social_media", category: "premade" },
  { voice_id: "Bill", name: "Bill", preview_url: "https://storage.googleapis.com/eleven-public-prod/premade/voices/pqHfZKP75CvOlQylNhV4/d782b3ff-84ba-4029-848c-acf01285524d.mp3", gender: "male", accent: "American", age: "old", description: "Friendly and comforting voice ready to narrate your stories.", use_case: "advertisement", category: "premade" },
  { voice_id: "Brian", name: "Brian", preview_url: "https://storage.googleapis.com/eleven-public-prod/premade/voices/nPczCjzI2devNBz1zQrb/2dd3e72c-4fd3-42f1-93ea-abc5d4e5aa1d.mp3", gender: "male", accent: "American", age: "middle_aged", description: "Middle-aged man with a resonant and comforting tone. Great for narrations and advertisements.", use_case: "social_media", category: "premade" },
  { voice_id: "Callum", name: "Callum", preview_url: "https://storage.googleapis.com/eleven-public-prod/premade/voices/N2lVS1w4EtoT3dr4eOWO/ac833bd8-ffda-4938-9ebc-b0f99ca25481.mp3", gender: "male", accent: "American", age: "middle_aged", description: "Deceptively gravelly, yet unsettling edge.", use_case: "characters_animation", category: "premade" },
  { voice_id: "Charlie", name: "Charlie", preview_url: "https://storage.googleapis.com/eleven-public-prod/premade/voices/IKne3meq5aSn9XLyUdCD/102de6f2-22ed-43e0-a1f1-111fa75c5481.mp3", gender: "male", accent: "Australian", age: "young", description: "A young Australian male with a confident and energetic voice.", use_case: "conversational", category: "premade" },
  { voice_id: "Chris", name: "Chris", preview_url: "https://storage.googleapis.com/eleven-public-prod/premade/voices/iP95p4xoKVk53GoZ742B/3f4bde72-cc48-40dd-829f-57fbf906f4d7.mp3", gender: "male", accent: "American", age: "middle_aged", description: "Natural and real, this down-to-earth voice is great across many use-cases.", use_case: "conversational", category: "premade" },
  { voice_id: "Daniel", name: "Daniel", preview_url: "https://storage.googleapis.com/eleven-public-prod/premade/voices/onwK4e9ZLuTAKqWW03F9/7eee0236-1a72-4b86-b303-5dcadc007ba9.mp3", gender: "male", accent: "British", age: "middle_aged", description: "A strong voice perfect for delivering a professional broadcast or news story.", use_case: "informative_educational", category: "premade" },
  { voice_id: "Eric", name: "Eric", preview_url: "https://storage.googleapis.com/eleven-public-prod/premade/voices/cjVigY5qzO86Huf0OWal/d098fda0-6456-4030-b3d8-63aa048c9070.mp3", gender: "male", accent: "American", age: "middle_aged", description: "A smooth tenor pitch from a man in his 40s - perfect for agentic use cases.", use_case: "conversational", category: "premade" },
  { voice_id: "George", name: "George", preview_url: "https://storage.googleapis.com/eleven-public-prod/premade/voices/JBFqnCBsd6RMkjVDRZzb/e6206d1a-0721-4787-aafb-06a6e705cac5.mp3", gender: "male", accent: "British", age: "middle_aged", description: "Warm resonance that instantly captivates listeners.", use_case: "narrative_story", category: "premade" },
  { voice_id: "SOYHLrjzK2X1ezoPC6cr", name: "Harry", preview_url: "https://storage.googleapis.com/eleven-public-prod/premade/voices/SOYHLrjzK2X1ezoPC6cr/86d178f6-f4b6-4e0e-85be-3de19f490794.mp3", gender: "male", accent: "American", age: "young", description: "An animated warrior ready to charge forward.", use_case: "characters_animation", category: "premade" },
  { voice_id: "Liam", name: "Liam", preview_url: "https://storage.googleapis.com/eleven-public-prod/premade/voices/TX3LPaxmHKxFdv7VOQHJ/63148076-6363-42db-aea8-31424308b92c.mp3", gender: "male", accent: "American", age: "young", description: "A young adult with energy and warmth - suitable for reels and shorts.", use_case: "social_media", category: "premade" },
  { voice_id: "Roger", name: "Roger", preview_url: "https://storage.googleapis.com/eleven-public-prod/premade/voices/CwhRBWXzGAHq8TQ4Fs17/58ee3ff5-f6f2-4628-93b8-e38eb31806b0.mp3", gender: "male", accent: "American", age: "middle_aged", description: "Easy going and perfect for casual conversations.", use_case: "conversational", category: "premade" },
  { voice_id: "Will", name: "Will", preview_url: "https://storage.googleapis.com/eleven-public-prod/premade/voices/bIHbv24MWmeRgasZH58o/8caf8f3d-ad29-4980-af41-53f20c72d7a4.mp3", gender: "male", accent: "American", age: "young", description: "Conversational and laid back.", use_case: "conversational", category: "premade" },

  // Non-binary (ElevenLabs labels the gender "neutral"; the picker buckets it as Other)
  { voice_id: "River", name: "River", preview_url: "https://storage.googleapis.com/eleven-public-prod/premade/voices/SAz9YHcvj6GT2YYXdXww/e6c95f0b-2227-491a-b3d7-2249240decb7.mp3", gender: "neutral", accent: "American", age: "middle_aged", description: "A relaxed, neutral voice ready for narrations or conversational projects.", use_case: "conversational", category: "premade" },
]
