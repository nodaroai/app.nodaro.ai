// GENERATED from the frontend's NODE_DEFINITIONS exposableFields (through
// frontend/src/components/presentation/exposable-declared-field-spec.ts) — do NOT hand-edit.
// Held to them by frontend/src/components/presentation/__tests__/exposable-declared-fields-table.test.ts; regenerate with
//   cd frontend && npx vitest run src/components/presentation/__tests__/exposable-declared-fields-table.test.ts -u
// Values only (what a hand-declared select / aspect-ratio / toggle field stores), no labels and no prices.

export interface ExposableDeclaredFieldSpec {
  /** A select (or aspect-ratio) card, or a toggle. */
  readonly kind: "select" | "toggle"
  /** Every value the field can take. */
  readonly values: ReadonlyArray<string | boolean>
}

/** Node type → hand-declared app field → what it takes. */
export const EXPOSABLE_DECLARED_FIELDS: Readonly<Record<string, Readonly<Record<string, ExposableDeclaredFieldSpec>>>> = {
  "ai-avatar": {
    "engine": { kind: "select", values: ["avatar-iv","avatar-v"] },
    "resolution": { kind: "select", values: ["720p","1080p","4k"] },
  },
  "cinematic-avatar": {
    "aspectRatio": { kind: "select", values: ["16:9","9:16","1:1"] },
    "resolution": { kind: "select", values: ["720p","1080p"] },
  },
  "edit-video-pro": {
    "generateAudio": { kind: "toggle", values: [true,false] },
    "provider": { kind: "select", values: ["seedance-2","seedance-2-fast","seedance-2-mini","seedance-2-5"] },
  },
  "extend-video": {
    "provider": { kind: "select", values: ["runway-extend","veo-extend","ltx-2.3-pro","seedance-2-extend"] },
  },
  "generate-image": {
    "aspectRatio": { kind: "select", values: ["1:1","16:9","9:16","4:3","3:4","3:2","2:3","5:4","4:5","21:9"] },
    "provider": { kind: "select", values: ["flux","flux-flex","flux-kontext","flux-kontext-max","gpt-image","gpt-image-2","gpt-image-2-5-flare","gpt-image-2-5-sunburst","grok","grok-2","ideogram-v3","imagen4","imagen4-fast","imagen4-ultra","nano-banana","nano-banana-2","nano-banana-2-1","nano-banana-2-lite","nano-banana-pro","qwen","seedream","seedream-5-lite","seedream-5-pro","seedream-5-flash","z-image","wan-2.7","wan-2.7-pro","flux-2-klein","flux-2-pro","flux-2-max"] },
    "quality": { kind: "select", values: ["medium","high","basic"] },
    "style": { kind: "select", values: ["__none__","3d-render","anime","children-book","cinematic","comic-book","digital-art","fantasy","minimalist","noir","oil-painting","pencil-sketch","photorealistic","pixel-art","pop-art","retro-vintage","watercolor","concept-art","impressionism","surrealism","cyberpunk","steampunk","vaporwave","low-poly","ink-wash","isometric","flat-vector","ukiyo-e","graffiti","claymation","glitch-art","ascii-art","blueprint","stained-glass","chalkboard","paper-cutout","illuminated","pixar-3d","caricature","fresco","mosaic","woodcut","etching","lithograph","charcoal","pastel","acrylic-paint","mixed-media","manga","early-color-photo"] },
  },
  "generate-music": {
    "instrumental": { kind: "toggle", values: [true,false] },
  },
  "generate-video": {
    "provider": { kind: "select", values: ["bytedance-lite","bytedance-pro","bytedance-pro-fast","grok-i2v","hailuo-2.3","hailuo-2.3-pro","hailuo-standard","kling","kling-3.0","kling-master","kling-turbo","minimax","runway-kie","minimax-h3","seedance","seedance-2","seedance-2-fast","seedance-2-mini","seedance-2-5","veo3","veo3.1","veo3_lite","wan-i2v","wan-turbo","wan-2.7-i2v","happyhorse-i2v","happyhorse-ref2v","ltx-2.3-pro","ltx-2.3-fast","gemini-omni-video","grok-imagine-video-1.5","wan-3","wan-3-prime","vidu-q4","gemini-omni-flash"] },
  },
  "generate-video-pro": {
    "aspectRatio": { kind: "select", values: ["16:9","9:16","1:1","4:3","3:4","21:9","adaptive"] },
    "generateAudio": { kind: "toggle", values: [true,false] },
    "noBackgroundMusic": { kind: "toggle", values: [true,false] },
    "provider": { kind: "select", values: ["seedance-2","seedance-2-fast","seedance-2-mini","seedance-2-5","minimax-h3","veo3.1","veo3_lite","gemini-omni-video","gemini-omni-flash","grok-i2v","wan-3","wan-3-prime","happyhorse-ref2v","vidu-q4"] },
    "resolution": { kind: "select", values: ["480p","720p","1080p","4k"] },
  },
  "image-to-video": {
    "provider": { kind: "select", values: ["bytedance-lite","bytedance-pro","bytedance-pro-fast","grok-i2v","hailuo-2.3","hailuo-2.3-pro","hailuo-standard","kling","kling-3.0","kling-master","kling-turbo","minimax","runway-kie","minimax-h3","seedance","seedance-2","seedance-2-fast","seedance-2-mini","seedance-2-5","veo3","veo3.1","veo3_lite","wan-i2v","wan-turbo","wan-2.7-i2v","happyhorse-i2v","happyhorse-ref2v","ltx-2.3-pro","ltx-2.3-fast","gemini-omni-video","grok-imagine-video-1.5","wan-3","wan-3-prime","vidu-q4","gemini-omni-flash"] },
  },
  "lip-sync": {
    "provider": { kind: "select", values: ["seedance-2","seedance-2-fast","seedance-2-mini","seedance-2-5","kling-avatar","kling-avatar-pro","infinitalk","omnihuman-1-5","latentsync","wav2lip","video-retalking","sadtalker","heygen-lipsync-precision","lipsync-2-pro","sync-lipsync-v3","volcengine-lipsync"] },
    "resolution": { kind: "select", values: ["720p","1080p"] },
  },
  "modify-image": {
    "provider": { kind: "select", values: ["flux-i2i","flux-pro-i2i","flux-kontext","flux-kontext-max","gpt-image-i2i","gpt-image-2-i2i","gpt-image-2-5-flare-i2i","gpt-image-2-5-sunburst-i2i","grok-i2i","ideogram-edit","ideogram-remix","nano-banana","nano-banana-2","nano-banana-2-1","nano-banana-2-lite","nano-banana-pro","qwen-i2i","qwen-edit","seedream-5-lite-i2i","seedream-5-pro-i2i","seedream-5-flash-i2i","seedream-edit","kontext-multi","flux-2-pro","flux-2-max","flux-fill","nano-banana-edit"] },
  },
  "speaker-view": {
    "layout": { kind: "select", values: ["auto","single","side-by-side","stacked","grid","pip"] },
    "targetAspect": { kind: "select", values: ["16:9","9:16","1:1","4:5"] },
  },
  "switchx": {
    "alphaMode": { kind: "select", values: ["auto","fill","select","custom"] },
  },
  "text-to-speech": {
    "provider": { kind: "select", values: ["elevenlabs-v4","elevenlabs-v3","elevenlabs-v4-turbo","elevenlabs-turbo","elevenlabs-multilingual"] },
  },
  "text-to-video": {
    "aspectRatio": { kind: "select", values: ["16:9","9:16","1:1"] },
    "generateAudio": { kind: "toggle", values: [true,false] },
    "provider": { kind: "select", values: ["bytedance-lite","bytedance-pro","grok","kling","kling-3.0","kling-turbo","minimax","hailuo-standard","runway-kie","minimax-h3","seedance","seedance-2","seedance-2-fast","seedance-2-mini","seedance-2-5","veo3","veo3.1","veo3_lite","wan","wan-turbo","wan-2.7-t2v","happyhorse","ltx-2.3-pro","ltx-2.3-fast","gemini-omni-video","grok-imagine-video-1.5","wan-3","wan-3-prime","vidu-q4","gemini-omni-flash"] },
  },
  "ugc-script": {
    "language": { kind: "select", values: ["en","he"] },
  },
  "upscale-image": {
    "provider": { kind: "select", values: ["recraft-upscale","topaz-image-upscale"] },
  },
  "video-retake": {
    "aspectRatio": { kind: "select", values: ["16:9","9:16"] },
    "generateAudio": { kind: "toggle", values: [true,false] },
    "retakeMode": { kind: "select", values: ["replace_audio_and_video","replace_audio","replace_video"] },
  },
  "voice-design": {
    "model": { kind: "select", values: ["eleven_ttv_v3","eleven_multilingual_ttv_v2"] },
  },
}
