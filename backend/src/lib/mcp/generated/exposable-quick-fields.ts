// GENERATED from the frontend's quick-strip controls (NODE_QUICK_CONFIGS, through
// frontend/src/components/presentation/exposable-quick-field-spec.ts) — do NOT hand-edit.
// Held to them by frontend/src/components/presentation/__tests__/exposable-quick-fields-table.test.ts; regenerate with
//   cd frontend && npx vitest run src/components/presentation/__tests__/exposable-quick-fields-table.test.ts -u
// Values only (the node-data values a field takes), no labels and no prices.

export interface ExposableQuickFieldSpec {
  /** The node-data type of the field's value. */
  readonly valueType: "string" | "number" | "boolean"
  /** Every value the field can take, across every model the node offers. */
  readonly values: ReadonlyArray<string | number | boolean>
  /** The same list whatever else the node is set to: a run is held to it. A provider-aware list is not. */
  readonly fixed: boolean
  /** Values the field still takes but no longer offers (a retired model): a run naming one is accepted, nothing advertises it. */
  readonly retained?: ReadonlyArray<string | number | boolean>
  /** A numeric field that also takes any value in this range. */
  readonly min?: number
  readonly max?: number
}

/** Node type → app field derived from a quick-strip control → what it takes. */
export const EXPOSABLE_QUICK_FIELDS: Readonly<Record<string, Readonly<Record<string, ExposableQuickFieldSpec>>>> = {
  "3d-title": {
    "llmModel": { valueType: "string", fixed: true, values: ["claude-fable-5","claude-haiku-4.5","claude-haiku-5.5","claude-opus-4.7","claude-opus-4.8","claude-opus-5","claude-opus-5.5","claude-sonnet-4.6","claude-sonnet-5","claude-sonnet-5.5","deepseek-v4.1-flash","gemini-3-flash","gemini-3.1-pro","gemini-3.6-flash","gemini-3.8-flash","gemini-4-argon","gpt-5.2","gpt-5.4","gpt-5.5","gpt-5.6-luna","gpt-5.6-sol","gpt-5.6-terra","gpt-6-astra","gpt-6-luna","gpt-6-sol","gpt-6.1-sol","grok-4.6","grok-4.7","kimi-k3"], retained: ["gemini-3.7-flash"] },
    "reasoningEffort": { valueType: "string", fixed: false, values: ["high","low","max","medium","none","xhigh"] },
  },
  "ai-avatar": {
    "avatarSource": { valueType: "string", fixed: true, values: ["avatar","image"] },
    "speechMode": { valueType: "string", fixed: true, values: ["audio","text"] },
  },
  "assemble-narrated-video": {
    "clipAudioVolume": { valueType: "number", fixed: true, values: [0,10,20,30,40,60,80,100] },
    "maxSlowdown": { valueType: "number", fixed: true, values: [1,1.1,1.25,1.5,1.75,2] },
    "voiceVolume": { valueType: "number", fixed: true, values: [0,25,50,75,100,125,150,200] },
  },
  "audio-separation": {
    "mode": { valueType: "string", fixed: true, values: ["stems","vocal_instrumental"] },
    "quality": { valueType: "string", fixed: true, values: ["auto","best","fast"] },
  },
  "cinematic-avatar": {
    "duration": { valueType: "number", fixed: false, values: [4,5,6,7,8,9,10,11,12,13,14,15] },
  },
  "content-ideas": {
    "llmModel": { valueType: "string", fixed: true, values: ["claude-fable-5","claude-haiku-4.5","claude-haiku-5.5","claude-opus-4.7","claude-opus-4.8","claude-opus-5","claude-opus-5.5","claude-sonnet-4.6","claude-sonnet-5","claude-sonnet-5.5","deepseek-v4.1-flash","gemini-3-flash","gemini-3.1-pro","gemini-3.6-flash","gemini-3.8-flash","gemini-4-argon","gpt-5.2","gpt-5.4","gpt-5.5","gpt-5.6-luna","gpt-5.6-sol","gpt-5.6-terra","gpt-6-astra","gpt-6-luna","gpt-6-sol","gpt-6.1-sol","grok-4.6","grok-4.7","kimi-k3"], retained: ["gemini-3.7-flash"] },
  },
  "content-recipe": {
    "llmModel": { valueType: "string", fixed: true, values: ["claude-fable-5","claude-haiku-4.5","claude-haiku-5.5","claude-opus-4.7","claude-opus-4.8","claude-opus-5","claude-opus-5.5","claude-sonnet-4.6","claude-sonnet-5","claude-sonnet-5.5","deepseek-v4.1-flash","gemini-3-flash","gemini-3.1-pro","gemini-3.6-flash","gemini-3.8-flash","gemini-4-argon","gpt-5.2","gpt-5.4","gpt-5.5","gpt-5.6-luna","gpt-5.6-sol","gpt-5.6-terra","gpt-6-astra","gpt-6-luna","gpt-6-sol","gpt-6.1-sol","grok-4.6","grok-4.7","kimi-k3"], retained: ["gemini-3.7-flash"] },
  },
  "describe-to-picker": {
    "llmModel": { valueType: "string", fixed: true, values: ["claude-fable-5","claude-haiku-4.5","claude-haiku-5.5","claude-opus-4.7","claude-opus-4.8","claude-opus-5","claude-opus-5.5","claude-sonnet-4.6","claude-sonnet-5","claude-sonnet-5.5","deepseek-v4.1-flash","gemini-3-flash","gemini-3.1-pro","gemini-3.6-flash","gemini-4-argon","gpt-5.4","gpt-5.5","gpt-5.6-luna","gpt-5.6-sol","gpt-5.6-terra","gpt-6-astra","gpt-6-luna","gpt-6-sol","gpt-6.1-sol","grok-4.6","grok-4.7","kimi-k3"], retained: ["gemini-3.7-flash"] },
    "reasoningEffort": { valueType: "string", fixed: false, values: ["high","low","max","medium","none","xhigh"] },
  },
  "dubbing": {
    "targetLanguage": { valueType: "string", fixed: true, values: ["af","ar","bg","bn","ca","cs","da","de","el","en","es","et","fa","fi","fil","fr","he","hi","hr","hu","id","is","it","ja","ka","ko","lt","lv","ms","nl","no","pl","pt","ro","ru","sk","sr","sv","sw","ta","th","tr","uk","ur","vi","zh"] },
  },
  "edit-3d-scene": {
    "llmModel": { valueType: "string", fixed: true, values: ["claude-fable-5","claude-haiku-4.5","claude-haiku-5.5","claude-opus-4.7","claude-opus-4.8","claude-opus-5","claude-opus-5.5","claude-sonnet-4.6","claude-sonnet-5","claude-sonnet-5.5","deepseek-v4.1-flash","gemini-3-flash","gemini-3.1-pro","gemini-3.6-flash","gemini-3.8-flash","gemini-4-argon","gpt-5.2","gpt-5.4","gpt-5.5","gpt-5.6-luna","gpt-5.6-sol","gpt-5.6-terra","gpt-6-astra","gpt-6-luna","gpt-6-sol","gpt-6.1-sol","grok-4.6","grok-4.7","kimi-k3"], retained: ["gemini-3.7-flash"] },
    "reasoningEffort": { valueType: "string", fixed: false, values: ["high","low","max","medium","none","xhigh"] },
  },
  "face-swap": {
    "provider": { valueType: "string", fixed: true, values: ["roop"] },
  },
  "generate-3d-scene": {
    "aspectRatio": { valueType: "string", fixed: true, values: ["16:9","1:1","4:5","9:16"] },
    "durationSeconds": { valueType: "number", fixed: true, min: 1, max: 60, values: [2,4,6,8,10,15,20,30] },
    "llmModel": { valueType: "string", fixed: true, values: ["claude-fable-5","claude-haiku-4.5","claude-haiku-5.5","claude-opus-4.7","claude-opus-4.8","claude-opus-5","claude-opus-5.5","claude-sonnet-4.6","claude-sonnet-5","claude-sonnet-5.5","deepseek-v4.1-flash","gemini-3-flash","gemini-3.1-pro","gemini-3.6-flash","gemini-3.8-flash","gemini-4-argon","gpt-5.2","gpt-5.4","gpt-5.5","gpt-5.6-luna","gpt-5.6-sol","gpt-5.6-terra","gpt-6-astra","gpt-6-luna","gpt-6-sol","gpt-6.1-sol","grok-4.6","grok-4.7","kimi-k3"], retained: ["gemini-3.7-flash"] },
    "reasoningEffort": { valueType: "string", fixed: false, values: ["high","low","max","medium","none","xhigh"] },
  },
  "generate-image": {
    "resolution": { valueType: "string", fixed: false, values: ["0.5 MP","1 MP","1K","2 MP","2K","4 MP","4K"] },
  },
  "generate-mask": {
    "threshold": { valueType: "number", fixed: true, values: [0.2,0.3,0.45] },
  },
  "generate-music": {
    "provider": { valueType: "string", fixed: true, values: ["minimax"] },
  },
  "generate-script": {
    "llmModel": { valueType: "string", fixed: true, values: ["claude-fable-5","claude-haiku-4.5","claude-haiku-5.5","claude-opus-4.7","claude-opus-4.8","claude-opus-5","claude-opus-5.5","claude-sonnet-4.6","claude-sonnet-5","claude-sonnet-5.5","deepseek-v4.1-flash","gemini-3-flash","gemini-3.1-pro","gemini-3.6-flash","gemini-3.8-flash","gemini-4-argon","gpt-5.2","gpt-5.4","gpt-5.5","gpt-5.6-luna","gpt-5.6-sol","gpt-5.6-terra","gpt-6-astra","gpt-6-luna","gpt-6-sol","gpt-6.1-sol","grok-4.6","grok-4.7","kimi-k3"], retained: ["gemini-3.7-flash"] },
    "reasoningEffort": { valueType: "string", fixed: false, values: ["high","low","max","medium","none","xhigh"] },
  },
  "generate-video": {
    "aspectRatio": { valueType: "string", fixed: false, values: ["16:9","1:1","21:9","3:4","4:3","4:5","5:4","9:16","9:21","adaptive"] },
    "draft": { valueType: "boolean", fixed: false, values: [true] },
    "duration": { valueType: "number", fixed: false, values: [-1,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30] },
    "resolution": { valueType: "string", fixed: false, values: ["1080P","1080p","2K","2k","480p","4k","512P","540p","720P","720p","768P"] },
  },
  "image-collage": {
    "aspectRatio": { valueType: "string", fixed: true, values: ["16:9","1:1","21:9","2:3","3:2","3:4","4:3","4:5","9:16"] },
    "layout": { valueType: "string", fixed: true, values: ["grid","smart"] },
    "resolution": { valueType: "string", fixed: true, values: ["2K","4K"] },
  },
  "image-critic": {
    "llmModel": { valueType: "string", fixed: true, values: ["claude-fable-5","claude-haiku-4.5","claude-haiku-5.5","claude-opus-4.7","claude-opus-4.8","claude-opus-5","claude-opus-5.5","claude-sonnet-4.6","claude-sonnet-5","claude-sonnet-5.5","deepseek-v4.1-flash","gemini-3-flash","gemini-3.1-pro","gemini-3.6-flash","gemini-3.8-flash","gemini-4-argon","gpt-5.2","gpt-5.4","gpt-5.5","gpt-5.6-luna","gpt-5.6-sol","gpt-5.6-terra","gpt-6-astra","gpt-6-luna","gpt-6-sol","gpt-6.1-sol","grok-4.6","grok-4.7","kimi-k3"], retained: ["gemini-3.7-flash"] },
    "reasoningEffort": { valueType: "string", fixed: false, values: ["high","low","max","medium","none","xhigh"] },
  },
  "image-to-text": {
    "llmModel": { valueType: "string", fixed: true, values: ["claude-fable-5","claude-haiku-4.5","claude-haiku-5.5","claude-opus-4.7","claude-opus-4.8","claude-opus-5","claude-opus-5.5","claude-sonnet-4.6","claude-sonnet-5","claude-sonnet-5.5","deepseek-v4.1-flash","gemini-3-flash","gemini-3.1-pro","gemini-3.6-flash","gemini-3.8-flash","gemini-4-argon","gpt-5.2","gpt-5.4","gpt-5.5","gpt-5.6-luna","gpt-5.6-sol","gpt-5.6-terra","gpt-6-astra","gpt-6-luna","gpt-6-sol","gpt-6.1-sol","grok-4.6","grok-4.7","kimi-k3"], retained: ["gemini-3.7-flash"] },
    "reasoningEffort": { valueType: "string", fixed: false, values: ["high","low","max","medium","none","xhigh"] },
  },
  "mask-composite": {
    "audioSource": { valueType: "string", fixed: false, values: ["background","foreground","mix","none"] },
    "backgroundFit": { valueType: "string", fixed: false, values: ["contain","cover","stretch"] },
  },
  "motion-graphics": {
    "llmModel": { valueType: "string", fixed: true, values: ["claude-fable-5","claude-haiku-4.5","claude-haiku-5.5","claude-opus-4.7","claude-opus-4.8","claude-opus-5","claude-opus-5.5","claude-sonnet-4.6","claude-sonnet-5","claude-sonnet-5.5","deepseek-v4.1-flash","gemini-3-flash","gemini-3.1-pro","gemini-3.6-flash","gemini-3.8-flash","gemini-4-argon","gpt-5.2","gpt-5.4","gpt-5.5","gpt-5.6-luna","gpt-5.6-sol","gpt-5.6-terra","gpt-6-astra","gpt-6-luna","gpt-6-sol","gpt-6.1-sol","grok-4.6","grok-4.7","kimi-k3"], retained: ["gemini-3.7-flash"] },
    "reasoningEffort": { valueType: "string", fixed: false, values: ["high","low","max","medium","none","xhigh"] },
  },
  "motion-transfer": {
    "provider": { valueType: "string", fixed: true, values: ["kling","kling-3.0","wan-animate-move","wan-animate-replace"] },
  },
  "qa-check": {
    "llmModel": { valueType: "string", fixed: true, values: ["claude-fable-5","claude-haiku-4.5","claude-haiku-5.5","claude-opus-4.7","claude-opus-4.8","claude-opus-5","claude-opus-5.5","claude-sonnet-4.6","claude-sonnet-5","claude-sonnet-5.5","deepseek-v4.1-flash","gemini-3-flash","gemini-3.1-pro","gemini-3.6-flash","gemini-3.8-flash","gemini-4-argon","gpt-5.2","gpt-5.4","gpt-5.5","gpt-5.6-luna","gpt-5.6-sol","gpt-5.6-terra","gpt-6-astra","gpt-6-luna","gpt-6-sol","gpt-6.1-sol","grok-4.6","grok-4.7","kimi-k3"], retained: ["gemini-3.7-flash"] },
    "reasoningEffort": { valueType: "string", fixed: false, values: ["high","low","max","medium","none","xhigh"] },
  },
  "reference-board": {
    "aspectRatio": { valueType: "string", fixed: false, values: ["16:27","16:9","1:1","21:9","27:16","2:3","3:2","3:4","4:3","4:5","5:4","8:9","9:16","9:8","auto"] },
    "provider": { valueType: "string", fixed: true, values: ["gpt-image-2","gpt-image-2-5-flare","gpt-image-2-5-sunburst","nano-banana-pro"] },
    "resolution": { valueType: "string", fixed: false, values: ["1K","2K","4K"] },
  },
  "reference-sheet": {
    "skin": { valueType: "string", fixed: true, values: ["blueprint","cinematic","illustrated","studio"] },
    "type": { valueType: "string", fixed: true, values: ["detail","full-reference","turnaround","variation-board"] },
  },
  "speech-to-video": {
    "resolution": { valueType: "string", fixed: true, values: ["480p","580p","720p"] },
  },
  "suno-add-instrumental": {
    "model": { valueType: "string", fixed: true, values: ["V4","V4_5","V4_5ALL","V4_5PLUS","V5","V5_5","V6","V6_MINI","V6_WILD"] },
  },
  "suno-add-vocals": {
    "model": { valueType: "string", fixed: true, values: ["V4","V4_5","V4_5ALL","V4_5PLUS","V5","V5_5","V6","V6_MINI","V6_WILD"] },
  },
  "suno-cover": {
    "model": { valueType: "string", fixed: true, values: ["V4","V4_5","V4_5ALL","V4_5PLUS","V5","V5_5","V6","V6_MINI","V6_WILD"] },
  },
  "suno-extend": {
    "model": { valueType: "string", fixed: true, values: ["V4","V4_5","V4_5ALL","V4_5PLUS","V5","V5_5","V6","V6_MINI","V6_WILD"] },
  },
  "suno-generate": {
    "instrumental": { valueType: "boolean", fixed: true, values: [false,true] },
    "model": { valueType: "string", fixed: true, values: ["V4","V4_5","V4_5ALL","V4_5PLUS","V5","V5_5","V6","V6_MINI","V6_WILD"] },
    "vocalGender": { valueType: "string", fixed: false, values: ["female","male"] },
  },
  "suno-mashup": {
    "model": { valueType: "string", fixed: true, values: ["V4","V4_5","V4_5ALL","V4_5PLUS","V5","V5_5","V6","V6_MINI","V6_WILD"] },
  },
  "suno-separate": {
    "type": { valueType: "string", fixed: true, values: ["separate_vocal","split_stem","split_stem_advanced"] },
  },
  "suno-upload-extend": {
    "model": { valueType: "string", fixed: true, values: ["V4","V4_5","V4_5ALL","V4_5PLUS","V5","V5_5","V6","V6_MINI","V6_WILD"] },
  },
  "switchx": {
    "alphaKeyframeIndex": { valueType: "number", fixed: false, values: [0,1,2,3,4,5,6,7,8,9] },
    "maxResolution": { valueType: "number", fixed: true, values: [720,1080] },
  },
  "text-to-audio": {
    "provider": { valueType: "string", fixed: true, values: ["elevenlabs-sfx"] },
  },
  "text-to-dialogue": {
    "languageCode": { valueType: "string", fixed: true, values: ["af","ar","bg","bn","ca","cs","da","de","el","en","es","et","fa","fi","fil","fr","he","hi","hr","hu","id","is","it","ja","ka","ko","lt","lv","ms","nl","no","pl","pt","ro","ru","sk","sr","sv","sw","ta","th","tr","uk","ur","vi","zh"] },
    "provider": { valueType: "string", fixed: true, values: ["elevenlabs-dialogue","elevenlabs-dialogue-v4"] },
  },
  "transcribe": {
    "provider": { valueType: "string", fixed: true, values: ["elevenlabs-stt"] },
  },
  "video-analysis": {
    "llmModel": { valueType: "string", fixed: true, values: ["fast","mixed","mixed-fast","pro","smart"] },
    "selectionMode": { valueType: "string", fixed: true, values: ["choose","combine"] },
  },
  "video-depth": {
    "colormap": { valueType: "string", fixed: false, values: ["grayscale","inferno","magma","turbo","viridis"] },
    "modelSize": { valueType: "string", fixed: true, values: ["base","large","small"] },
    "provider": { valueType: "string", fixed: true, values: ["depth-anything-frames","video-depth-anything"] },
    "resolution": { valueType: "string", fixed: false, values: ["1080p","360p","480p","720p","auto"] },
    "sideBySide": { valueType: "boolean", fixed: false, values: [false,true] },
  },
  "video-mask": {
    "threshold": { valueType: "number", fixed: true, min: 0.05, max: 0.95, values: [0.3,0.5,0.7] },
  },
  "video-overlay": {
    "outputAspect": { valueType: "string", fixed: true, values: ["16:9","1:1","4:5","9:16"] },
  },
  "video-to-video": {
    "draft": { valueType: "boolean", fixed: false, values: [true] },
    "provider": { valueType: "string", fixed: true, values: ["happyhorse-edit","luma-modify","runway-aleph","seedance-2-5","wan","wan-flash","wan-videoedit"] },
    "v2vResolution": { valueType: "string", fixed: false, values: ["1080p","480p","720p"] },
  },
  "video-upscale": {
    "provider": { valueType: "string", fixed: true, values: ["seedance-2-5-hd","topaz","veo-1080p","veo-4k"] },
  },
  "voice-changer": {
    "model": { valueType: "string", fixed: true, values: ["eleven_english_sts_v2","eleven_multilingual_sts_v2"] },
  },
  "voice-changer-pro": {
    "model": { valueType: "string", fixed: true, values: ["eleven_english_sts_v2","eleven_multilingual_sts_v2"] },
  },
}
