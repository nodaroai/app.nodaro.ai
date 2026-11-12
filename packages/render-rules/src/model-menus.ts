/**
 * The editor's model menus: the rows each node's model menu lists, in the
 * order it renders them (decided 2026-11-10: "the first model the menu offers"
 * is one rule, run by the editor and by the server, so the order is one list).
 * The editor's panels and quick strips render these (re-exported from
 * `model-options.ts`); the new-node rule (`node-model-levers.ts`) reads the
 * same rows on both sides. Each row's `value` is what the menu writes into the
 * node; for every list here but Motion Transfer's it is the catalog id of the
 * model the node runs (`provider-model.ts` maps the exceptions).
 */
import {
  GVP_SUPPORTED_PROVIDERS,
  VIDEO_GEN_COLLAPSED_T2V_IDS,
  isGvpSupportedProvider,
  isSeedance2Provider,
  type DialogueProvider,
  type ImageGenProvider,
  type ImageI2IProvider,
  type LipSyncProvider,
  type MotionTransferProviderType,
  type TextToVideoProvider,
  type VideoGenProvider,
  type VideoToVideoNodeProvider,
} from "@nodaro/shared/models"
import type { VideoDepthProvider } from "@nodaro/shared/media"

export const IMAGE_GEN_MODELS: readonly { value: ImageGenProvider; label: string; desc: string }[] = [
  { value: "flux", label: "Flux", desc: "Photorealistic, highest quality output" },
  { value: "flux-flex", label: "Flux Flex", desc: "Flexible Flux, fast generation" },
  { value: "flux-kontext", label: "Flux Kontext", desc: "Context-aware generation and editing" },
  { value: "flux-kontext-max", label: "Flux Kontext Max", desc: "Highest quality Kontext generation" },
  { value: "gpt-image", label: "GPT Image", desc: "Text rendering, complex compositions" },
  { value: "gpt-image-2", label: "GPT Image 2", desc: "Latest GPT Image, sharper text + photorealism, up to 4K" },
  { value: "gpt-image-2-5-flare", label: "GPT Image 2.5 Flare", desc: "Fast everyday GPT Image 2.5 — ~2x quicker, great for iteration" },
  { value: "gpt-image-2-5-sunburst", label: "GPT Image 2.5 Sunburst", desc: "Precision GPT Image 2.5 — slower, best for final/brand work" },
  { value: "gpt-image-2-6-flare", label: "GPT Image 2.6 Flare", desc: "Fast GPT Image 2.6 — pick for speed, up to 4K" },
  { value: "gpt-image-2-6-sunburst", label: "GPT Image 2.6 Sunburst", desc: "Precision GPT Image 2.6 — when every detail counts" },
  { value: "gpt-image-2-6-economy", label: "GPT Image 2.6 Economy", desc: "GPT Image 2.6 at a flat low price, 1K — pick for volume" },
  { value: "grok", label: "Grok", desc: "Creative and stylized imagery" },
  { value: "grok-2", label: "Grok Imagine 2", desc: "Latest Grok — expressive, high-contrast imagery" },
  { value: "ideogram-v3", label: "Ideogram V3", desc: "Fast text-to-image, affordable" },
  { value: "imagen4", label: "Imagen 4", desc: "Google's latest, strong prompt adherence" },
  { value: "imagen4-fast", label: "Imagen 4 Fast", desc: "Fast Imagen, lower latency" },
  { value: "imagen4-ultra", label: "Imagen 4 Ultra", desc: "Highest quality Google image gen" },
  { value: "nano-banana", label: "Nano Banana", desc: "Fast drafts, iteration, storyboards" },
  { value: "nano-banana-2", label: "Nano Banana 2", desc: "Updated Nano Banana with web grounding" },
  { value: "nano-banana-2-1", label: "Nano Banana 2.1", desc: "Sharper quality, text and character consistency, up to 4K" },
  { value: "nano-banana-2-lite", label: "Nano Banana 2 Lite", desc: "Fast, low-cost 1K drafts and iteration" },
  { value: "nano-banana-pro", label: "Nano Banana Pro", desc: "Higher detail, production-ready images" },
  { value: "qwen", label: "Qwen", desc: "Versatile, good at diverse styles" },
  { value: "seedream", label: "Seedream", desc: "Photorealistic, high detail" },
  { value: "seedream-5-lite", label: "Seedream 5 Lite", desc: "Latest Seedream, fast and sharp" },
  { value: "seedream-5-pro", label: "Seedream 5 Pro", desc: "Flagship Seedream, best instruction following" },
  { value: "seedream-5-flash", label: "Seedream 5 Flash", desc: "Fast, low-cost Seedream at 1K or 2K" },
  { value: "minimax-h3-image", label: "MiniMax H3 Image", desc: "Readable text in the picture, up to 4K, same price at 1K and 2K" },
  { value: "seedream-5-5", label: "Seedream 5.5", desc: "Natural light, materials and skin, small text, transparent backgrounds" },
  { value: "z-image", label: "Z-Image", desc: "Fast, lightweight generation" },
  { value: "wan-2.7",     label: "Wan 2.7",     desc: "T2I, 1K/2K/4K, up to 9 ref images" },
  { value: "wan-2.7-pro", label: "Wan 2.7 Pro", desc: "Higher quality T2I, 1K/2K/4K" },
  { value: "flux-2-klein", label: "Flux 2 Klein (Open)", desc: "BFL Flux 2 9B via Replicate — fast" },
  { value: "flux-2-pro", label: "Flux 2 Pro (Safety Tolerance)", desc: "BFL Flux 2 Pro via Replicate — flagship quality" },
  { value: "flux-2-max", label: "Flux 2 Max (Safety Tolerance)", desc: "BFL Flux 2 Max via Replicate — even larger sibling, up to 8 refs (variable pricing: 2-62 cr)" },
]

export const IMAGE_I2I_MODELS: readonly { value: ImageI2IProvider; label: string; desc: string }[] = [
  { value: "flux-i2i", label: "Flux-2", desc: "Style-faithful transformations" },
  { value: "flux-pro-i2i", label: "Flux-2 Pro", desc: "Premium quality image transforms" },
  { value: "flux-kontext", label: "Flux Kontext", desc: "Context-aware editing via Kontext" },
  { value: "flux-kontext-max", label: "Flux Kontext Max", desc: "Highest quality Kontext editing" },
  { value: "gpt-image-i2i", label: "GPT Image", desc: "Text rendering, complex compositions" },
  { value: "gpt-image-2-i2i", label: "GPT Image 2", desc: "Latest GPT Image, sharper text + photorealism, up to 4K" },
  { value: "gpt-image-2-5-flare-i2i", label: "GPT Image 2.5 Flare", desc: "Fast GPT Image 2.5 edits — up to 16 sources, best for iteration" },
  { value: "gpt-image-2-5-sunburst-i2i", label: "GPT Image 2.5 Sunburst", desc: "Precision GPT Image 2.5 edits — tightest control, slower" },
  { value: "gpt-image-2-6-flare-i2i", label: "GPT Image 2.6 Flare", desc: "Fast GPT Image 2.6 edits — up to 16 sources, priced per image" },
  { value: "gpt-image-2-6-sunburst-i2i", label: "GPT Image 2.6 Sunburst", desc: "Precision GPT Image 2.6 edits — up to 16 sources, priced per image" },
  { value: "gpt-image-2-6-economy-i2i", label: "GPT Image 2.6 Economy", desc: "Flat-price GPT Image 2.6 edits, 1K — pick for volume" },
  { value: "grok-i2i", label: "Grok", desc: "Creative and stylized imagery" },
  { value: "ideogram-edit", label: "Ideogram Edit", desc: "AI-guided image editing" },
  { value: "ideogram-remix", label: "Ideogram Remix", desc: "Restyle with character consistency" },
  { value: "nano-banana", label: "Nano Banana", desc: "Fast iteration, quick transforms" },
  { value: "nano-banana-2", label: "Nano Banana 2", desc: "Updated Nano Banana — web-grounded transforms, up to 4K" },
  { value: "nano-banana-2-1", label: "Nano Banana 2.1", desc: "Consistent edits, up to 10 references and 4K output" },
  { value: "nano-banana-2-lite", label: "Nano Banana 2 Lite", desc: "Fast 1K edits, up to 10 reference images" },
  { value: "nano-banana-pro", label: "Nano Banana Pro", desc: "Higher detail, production images" },
  { value: "qwen-i2i", label: "Qwen", desc: "Versatile image transformation" },
  { value: "qwen-edit", label: "Qwen Edit", desc: "Targeted image editing" },
  { value: "seedream-5-lite-i2i", label: "Seedream 5 Lite", desc: "Latest Seedream image-to-image" },
  { value: "seedream-5-pro-i2i", label: "Seedream 5 Pro", desc: "Pro Seedream image-to-image, multi-reference edits" },
  { value: "seedream-5-flash-i2i", label: "Seedream 5 Flash", desc: "Fast, low-cost Seedream edits, up to 10 input images" },
  { value: "minimax-h3-image-i2i", label: "MiniMax H3 Image", desc: "Up to 16 reference images in one edit, readable text, up to 4K" },
  { value: "seedream-5-5-i2i", label: "Seedream 5.5", desc: "Edits that keep the rest of the picture, up to 10 input images" },
  { value: "seedream-edit", label: "Seedream Edit", desc: "Photorealistic image editing" },
  { value: "kontext-multi", label: "Kontext Multi (Open)", desc: "Multi-image Flux Kontext via Replicate — up to 4 refs" },
  { value: "flux-2-pro", label: "Flux 2 Pro (Safety Tolerance)", desc: "BFL Flux 2 Pro via Replicate — flagship quality" },
  { value: "flux-2-max", label: "Flux 2 Max (Safety Tolerance)", desc: "BFL Flux 2 Max via Replicate — up to 8 refs (variable pricing: 2-62 cr)" },
  { value: "flux-fill", label: "Flux Fill (Inpaint)", desc: "BFL FLUX Fill Pro via Replicate — dedicated masked inpainting (white = edit area)" },
]

export const MODIFY_IMAGE_MODELS = [
  ...IMAGE_I2I_MODELS,
  { value: "nano-banana-edit", label: "Nano Banana Edit", description: "AI-powered image editing with instructions" },
]

export const UPSCALE_IMAGE_MODELS = [
  { value: "recraft-upscale", label: "Recraft Upscale", description: "Fast, high-quality upscaling" },
  { value: "topaz-image-upscale", label: "Topaz Upscale", description: "Premium AI upscaling with a 1x / 2x / 4x factor" },
  { value: "nodaro-image-upscale", label: "Nodaro Image Upscale", description: "Upscale up to 8x, lettering kept exactly as written" },
]

export const VIDEO_I2V_MODELS = [
  { value: "bytedance-lite", label: "Bytedance Lite", desc: "Light, fast, end frame support" },
  { value: "bytedance-pro", label: "Bytedance Pro", desc: "Higher quality Bytedance" },
  { value: "bytedance-pro-fast", label: "Bytedance Pro Fast", desc: "Fast pro generation" },
  { value: "grok-i2v", label: "Grok Imagine 1", desc: "Creative, stylized motion" },
  { value: "hailuo-2.3", label: "Hailuo 2.3", desc: "Latest Hailuo, 6-10s standard" },
  { value: "hailuo-2.3-pro", label: "Hailuo 2.3 Pro", desc: "Latest Hailuo, 6-10s pro quality" },
  { value: "hailuo-standard", label: "Hailuo Standard", desc: "Hailuo 02, end frame support" },
  { value: "kling", label: "Kling", desc: "Versatile, 5-10s clips" },
  { value: "kling-3.0", label: "Kling 3.0", desc: "Latest Kling, 3-15s variable duration" },
  { value: "kling-master", label: "Kling Master", desc: "Kling V2.1 Master, high quality" },
  { value: "kling-turbo", label: "Kling Turbo", desc: "Fast generation, end frame support" },
  { value: "minimax", label: "MiniMax", desc: "Fast, reliable 5s clips" },
  { value: "runway-kie", label: "Runway", desc: "Runway Gen-3, 5-10s, 720p/1080p" },
  { value: "minimax-h3", label: "minimax-h3", desc: "MiniMax premium, 4-15s, 2K or 768P, multimodal references, native audio" },
  { value: "seedance-2", label: "Seedance 2.0", desc: "Bytedance, 4-15s, multimodal references" },
  { value: "seedance-2-fast", label: "Seedance 2.0 Fast", desc: "Bytedance Fast, 4-15s, multimodal references" },
  { value: "seedance-2-mini", label: "Seedance 2.0 Mini", desc: "Bytedance budget, 4-15s, 480p/720p" },
  { value: "seedance-2-5", label: "Seedance 2.5", desc: "Bytedance latest, up to 30s in one shot, wide multimodal refs, 480p/720p/1080p" },
  { value: "veo3", label: "VEO 3.1 (Quality)", desc: "Top quality, 4/6/8s with audio" },
  { value: "veo3.1", label: "VEO 3.1 (Fast)", desc: "Fast VEO, 4/6/8s with audio" },
  { value: "veo3_lite", label: "VEO 3.1 (Lite)", desc: "Cheapest VEO tier, 4/6/8s with audio" },
  { value: "wan-i2v", label: "Wan 2.6", desc: "Wan I2V, 5-15s, resolution options" },
  { value: "wan-turbo", label: "Wan Turbo", desc: "Fast Wan, 5s clips" },
  { value: "wan-2.7-i2v",    label: "Wan 2.7",            desc: "Wan 2.7 I2V, 2–15s, 720p/1080p, start+end frame" },
  { value: "happyhorse-i2v",  label: "HappyHorse 1.1",        desc: "3–15s, 720p/1080p, image or text, per-second pricing" },
  { value: "happyhorse-ref2v", label: "HappyHorse 1.1 Ref2V", desc: "1–9 reference images to video, 3–15s, per-second pricing" },
  // kling-3-omni pulled from the picker: it has a Replicate impl but no working
  // dispatch path (the i2v routing chain is KIE-only and there is no worker
  // short-circuit like LTX's), so every run failed at the router. Re-enable only
  // after wiring a worker short-circuit AND verifying a live generation. The
  // backend enum + cost entry stay so legacy saved workflows still validate.
  { value: "ltx-2.3-pro", label: "LTX 2.3 Pro", desc: "Lightricks LTX 2.3 Pro — text/image/audio→video, up to 4K" },
  { value: "ltx-2.3-fast", label: "LTX 2.3 Fast", desc: "Lightricks LTX 2.3 Fast — text/image→video, durations up to 20s" },
  { value: "gemini-omni-video", label: "Gemini Omni", desc: "Google, 4–10s, 720p/1080p/4K, native audio, refs + video-edit" },
  { value: "grok-imagine-video-1.5", label: "Grok Imagine 1.5", desc: "xAI Grok, 1–15s, 480p–1080p, start + up to 4 in-between + end frames, per-second pricing" },
  { value: "wan-3", label: "Wan 3.0", desc: "Alibaba Wan 3.0, 2–30s, 480p/720p/1080p, native audio, image/video/audio refs" },
  { value: "wan-3-prime", label: "Wan 3.0 Prime", desc: "High-speed Wan 3.0, 2–30s, 480p/720p/1080p, native audio, image/video/audio refs" },
  { value: "vidu-q4", label: "Vidu Q4", desc: "ShengShu Vidu Q4, 3–16s, 540p–4K, native audio, start frame or 15 image + 3 MP3 audio refs" },
  { value: "kling-4", label: "Kling 4.0", desc: "Kuaishou Kling 4.0, 3–30s, 720p/1080p, native audio, image/video/character/voice refs" },
  { value: "kling-4-keyframes", label: "Kling 4.0 Keyframes", desc: "Kuaishou Kling 4.0, 3–30s, start + up to 8 in-between + end frames, native audio" },
  { value: "kling-4-flash", label: "Kling 4.0 Flash", desc: "Kuaishou Kling 4.0 Flash, 3–20s, 720p, native audio, start frame or image/video/character refs, voice per character" },
  { value: "gemini-omni-flash", label: "Gemini Omni Flash", desc: "Google, 4–10s, 720p/1080p/4K, native audio, refs + video-edit" },
  { value: "gemini-omni-flash-1-2", label: "Gemini Omni Flash 1.2", desc: "Google, 3–15s, 360p to 4K, native audio, refs + video-edit" },
  { value: "pixverse-v6-max", label: "PixVerse V6 Max", desc: "PixVerse, 1–15s, 360p–1080p, optional native audio, text or an exact first frame" },
]

export const VIDEO_T2V_MODELS: readonly { value: TextToVideoProvider; label: string; desc: string }[] = [
  { value: "bytedance-lite", label: "Bytedance Lite", desc: "Fast, 5-10s" },
  { value: "bytedance-pro", label: "Bytedance Pro", desc: "High quality, 5-10s" },
  { value: "grok", label: "Grok Imagine 1", desc: "Creative, stylized motion" },
  { value: "kling", label: "Kling", desc: "Versatile, 5-10s clips" },
  { value: "kling-3.0", label: "Kling 3.0", desc: "Latest Kling, 3-15s variable duration" },
  { value: "kling-turbo", label: "Kling Turbo", desc: "Fast generation, 5-10s" },
  { value: "minimax", label: "MiniMax", desc: "Fast, reliable 5s clips" },
  { value: "hailuo-standard", label: "MiniMax Standard", desc: "Budget Hailuo, 6-10s" },
  { value: "runway-kie", label: "Runway", desc: "Runway Gen-3, 5-10s, 720p/1080p" },
  { value: "minimax-h3", label: "minimax-h3", desc: "MiniMax premium, 4-15s, 2K or 768P, multimodal references, native audio" },
  { value: "seedance-2", label: "Seedance 2.0", desc: "Bytedance, 4-15s, multimodal references" },
  { value: "seedance-2-fast", label: "Seedance 2.0 Fast", desc: "Bytedance Fast, 4-15s, multimodal references" },
  { value: "seedance-2-mini", label: "Seedance 2.0 Mini", desc: "Bytedance budget, 4-15s, 480p/720p" },
  { value: "seedance-2-5", label: "Seedance 2.5", desc: "Bytedance latest, up to 30s in one shot, wide multimodal refs, 480p/720p/1080p" },
  { value: "veo3", label: "VEO 3.1 (Quality)", desc: "Top quality, 4/6/8s with audio" },
  { value: "veo3.1", label: "VEO 3.1 (Fast)", desc: "Fast VEO, 4/6/8s with audio" },
  { value: "veo3_lite", label: "VEO 3.1 (Lite)", desc: "Cheapest VEO tier, 4/6/8s with audio" },
  { value: "wan", label: "Wan 2.6", desc: "High quality, 5-15s, 1080p" },
  { value: "wan-turbo", label: "Wan Turbo", desc: "Fast generation, 5s clips" },
  { value: "wan-2.7-t2v", label: "Wan 2.7",    desc: "Wan 2.7 T2V, 2–15s, 720p/1080p" },
  { value: "happyhorse",   label: "HappyHorse 1.1", desc: "3–15s, 720p/1080p, 9 aspect ratios, per-second pricing" },
  { value: "ltx-2.3-pro", label: "LTX 2.3 Pro", desc: "Lightricks LTX 2.3 Pro — text/image/audio→video, up to 4K" },
  { value: "ltx-2.3-fast", label: "LTX 2.3 Fast", desc: "Lightricks LTX 2.3 Fast — text/image→video, durations up to 20s" },
  { value: "gemini-omni-video", label: "Gemini Omni", desc: "Google, 4–10s, 720p/1080p/4K, native audio, refs + video-edit" },
  { value: "grok-imagine-video-1.5", label: "Grok Imagine 1.5", desc: "xAI Grok, 1–15s, 480p–1080p, start + up to 4 in-between + end frames (image required)" },
  { value: "wan-3", label: "Wan 3.0", desc: "Alibaba Wan 3.0, 2–30s, 480p/720p/1080p, native audio, image/video/audio refs" },
  { value: "wan-3-prime", label: "Wan 3.0 Prime", desc: "High-speed Wan 3.0, 2–30s, 480p/720p/1080p, native audio, image/video/audio refs" },
  { value: "vidu-q4", label: "Vidu Q4", desc: "ShengShu Vidu Q4, 3–16s, 540p–4K, native audio (image required)" },
  { value: "kling-4", label: "Kling 4.0", desc: "Kuaishou Kling 4.0, 3–30s, 720p/1080p, native audio, image/video/character/voice refs" },
  { value: "kling-4-keyframes", label: "Kling 4.0 Keyframes", desc: "Kuaishou Kling 4.0, 3–30s, start + up to 8 in-between + end frames, native audio" },
  { value: "kling-4-flash", label: "Kling 4.0 Flash", desc: "Kuaishou Kling 4.0 Flash, 3–20s, 720p, native audio, start frame or image/video/character refs, voice per character" },
  { value: "gemini-omni-flash", label: "Gemini Omni Flash", desc: "Google, 4–10s, 720p/1080p/4K, native audio, refs + video-edit" },
  { value: "gemini-omni-flash-1-2", label: "Gemini Omni Flash 1.2", desc: "Google, 3–15s, 360p to 4K, native audio, refs + video-edit" },
  { value: "pixverse-v6-max", label: "PixVerse V6 Max", desc: "PixVerse, 1–15s, 360p–1080p, 8 aspect ratios, optional native audio" },
]

/** Unified generate-video model list — VIDEO_I2V_MODELS ∪ VIDEO_T2V_MODELS,
 *  deduplicated by id. The generate-video node accepts either an upstream
 *  image (i2v path) or pure text (t2v path) per provider's modes, so the
 *  picker exposes every provider that participates in at least one mode.
 *  I2V entries win on collision because their label/desc is the more
 *  general "image-or-text" descriptor in most cases.
 *
 *  Split-id models (Grok Imagine 1, Wan 2.6, Wan 2.7) expose one id per mode
 *  but are ONE user-facing model. We hide the t2v twin (VIDEO_GEN_COLLAPSED_T2V_IDS)
 *  so the picker shows a single row; execution remaps base→mode id by image
 *  presence via resolveVideoProviderForMode (shared). Single source of truth. */
export const VIDEO_GEN_MODELS: readonly { value: VideoGenProvider; label: string; desc: string }[] =
  (() => {
    const seen = new Set<string>()
    const out: { value: VideoGenProvider; label: string; desc: string }[] = []
    for (const m of [...VIDEO_I2V_MODELS, ...VIDEO_T2V_MODELS]) {
      if (seen.has(m.value)) continue
      if (VIDEO_GEN_COLLAPSED_T2V_IDS.has(m.value)) continue
      seen.add(m.value)
      out.push(m as { value: VideoGenProvider; label: string; desc: string })
    }
    return out
  })()

/** Generate Video Pro's provider set — ONLY the SKUs the pro multi-segment
 *  engine supports (Seedance 2 + Seedance 2 Fast; mini withdrawn 2026-07-21;
 *  minimax-h3 blessed 2026-08-02). Filtered from VIDEO_GEN_MODELS by the
 *  shared `isGvpSupportedProvider` predicate (the support list lives in
 *  @nodaro/shared next to the capability family), so id/label/desc can never
 *  drift from the canonical catalog — no hand-written label strings — and
 *  ORDERED by GVP_SUPPORTED_PROVIDERS so the default (seedance-2) lists
 *  first regardless of catalog order. Edit Video Pro consumes the Seedance-only
 *  EVP_PROVIDERS subset below. */
export const GVP_PROVIDERS: readonly { value: VideoGenProvider; label: string; desc: string }[] =
  [...VIDEO_GEN_MODELS.filter((m) => isGvpSupportedProvider(m.value))].sort(
    (x, y) =>
      (GVP_SUPPORTED_PROVIDERS as readonly string[]).indexOf(x.value) -
      (GVP_SUPPORTED_PROVIDERS as readonly string[]).indexOf(y.value),
  )

/** Edit Video Pro's provider set — the Seedance-only SUBSET of GVP_PROVIDERS.
 *  EVP edits an EXISTING video on the pro engine; minimax-h3 (blessed for
 *  GENERATION 2026-08-02) has no v2v mode in the catalog and its pricing has
 *  no `-ref` axis, so it stays out of EVP until separately validated. The
 *  filter derives from the shared family predicate — a future blessed
 *  Seedance SKU flows in automatically, a non-Seedance one stays out. */
export const EVP_PROVIDERS: readonly { value: VideoGenProvider; label: string; desc: string }[] =
  GVP_PROVIDERS.filter((m) => isSeedance2Provider(m.value))

/**
 * Every model the Video to Video NODE offers — typed `VideoToVideoNodeProvider`,
 * NOT `VideoToVideoProvider`: the Seedance entry is deliberately not a
 * `/v1/video-to-video` route provider. Seedance has no v2v endpoint, so that
 * lane dispatches as a text-to-video job in edit shape (see
 * SEEDANCE_VIDEO_EDIT_PROVIDERS in @nodaro/shared). `route-enum-sync.test.ts`
 * pins the split.
 */
export const VIDEO_V2V_MODELS: readonly { value: VideoToVideoNodeProvider; label: string; desc: string }[] = [
  { value: "seedance-2-5", label: "Seedance 2.5 Edit", desc: "Edit the clip by instruction — keeps its length and ratio; add image references" },
  { value: "luma-modify", label: "Luma Modify", desc: "Luma video modification" },
  { value: "runway-aleph", label: "Runway Aleph", desc: "Runway AI video-to-video conversion" },
  { value: "happyhorse-edit", label: "HappyHorse Edit", desc: "Video-to-video editing, up to 60s input" },
  { value: "wan-videoedit", label: "Wan 2.7 VideoEdit", desc: "Guided video editing with reference image support" },
  { value: "wan", label: "Wan 2.6", desc: "High quality video-to-video" },
  { value: "wan-flash", label: "Wan 2.6 Flash", desc: "Fast V2V with audio & multi-shot" },
]

/** Seedance first, one row per model (decided 2026-11-11); a new Extend node still starts on VEO (`EXTEND_VIDEO_DEFAULT_PROVIDER`). */
export const EXTEND_VIDEO_MODELS = [
  { value: "seedance-2-5-extend", label: "Seedance 2.5" },
  { value: "seedance-2-0-extend", label: "Seedance 2.0" },
  { value: "veo-extend", label: "VEO Extend" },
  { value: "runway-extend", label: "Runway Extend" },
  { value: "ltx-2.3-pro", label: "LTX 2.3 Pro" },
] as const

export const LIP_SYNC_MODELS: readonly { value: LipSyncProvider; label: string; desc: string }[] = [
  { value: "seedance-2", label: "Seedance 2", desc: "Native phoneme lip sync, 8+ languages, cinematic. Premium quality." },
  { value: "seedance-2-fast", label: "Seedance 2 Fast", desc: "Same lip sync, cheaper / quicker tier" },
  { value: "seedance-2-mini", label: "Seedance 2 Mini", desc: "Same lip sync, budget tier, 480p/720p" },
  { value: "seedance-2-5", label: "Seedance 2.5", desc: "Same lip sync, latest generation, up to 30s, 480p/720p/1080p" },
  { value: "kling-avatar", label: "Kling Avatar", desc: "Talking head, 720p, speech-optimized" },
  { value: "kling-avatar-pro", label: "Kling Avatar Pro", desc: "Premium talking head, 1080p" },
  { value: "infinitalk", label: "Infinitalk", desc: "KIE flexible resolution, 480p\u2013720p" },
  { value: "omnihuman-1-5", label: "OmniHuman 1.5", desc: "Prompt-directed talking avatar, 720p\u20131080p, premium" },
  { value: "latentsync", label: "LatentSync", desc: "Diffusion-based, best for singing" },
  { value: "wav2lip", label: "Wav2Lip", desc: "Fastest and cheapest, image or video input" },
  { value: "video-retalking", label: "Video-Retalking", desc: "Built-in face enhancement, clean output" },
  { value: "sadtalker", label: "SadTalker", desc: "Talking avatar from single image" },
  { value: "heygen-lipsync-precision", label: "HeyGen Lipsync Precision", desc: "Avatar-inference dubbing on a video. Dynamic duration, premium." },
  { value: "lipsync-2-pro", label: "Lipsync 2 Pro", desc: "Studio-grade sync.so lip sync. Video input, expressive." },
  { value: "sync-lipsync-v3", label: "Sync Lipsync v3", desc: "fal.ai sync.so v3 dubbing. Video input, billed per second." },
  { value: "volcengine-lipsync", label: "Volcengine Lip Sync", desc: "Video-to-video AI dubbing. Multi-speaker (basic mode). Cheapest modern dubbing, billed per second." },
]

export const TTS_MODELS: readonly { value: string; label: string; desc: string }[] = [
  { value: "elevenlabs-v3", label: "ElevenLabs v3", desc: "Expressive, supports audio tags for emotions" },
  { value: "elevenlabs-v4", label: "ElevenLabs v4", desc: "Newest, supports audio tags, up to 10,000 characters" },
  { value: "elevenlabs-v4-turbo", label: "ElevenLabs v4 Turbo", desc: "Faster, cheaper v4 at lower fidelity; supports audio tags" },
  { value: "elevenlabs-turbo", label: "ElevenLabs Turbo v2.5", desc: "Fast generation, 32 languages" },
  { value: "elevenlabs-multilingual", label: "ElevenLabs Multilingual v2", desc: "29 languages, natural delivery" },
]

/**
 * The Text to Dialogue models (panel dropdown + quick strip), in `DIALOGUE_PROVIDERS`
 * order — the route's enum; `model-options.test.ts` pins the two together. v3
 * dialogue stays the default (decided 2026-10-04).
 */
export const DIALOGUE_MODELS: readonly { value: DialogueProvider; label: string; desc: string }[] = [
  { value: "elevenlabs-dialogue", label: "ElevenLabs Dialogue v3", desc: "Expressive, supports audio tags; stability in three steps" },
  { value: "elevenlabs-dialogue-v4", label: "ElevenLabs Dialogue v4", desc: "Newest, supports audio tags, stability and similarity" },
]

export const MOTION_TRANSFER_MODELS: readonly { value: MotionTransferProviderType; label: string; desc: string }[] = [
  { value: "kling", label: "Kling 2.6", desc: "Standard motion transfer" },
  { value: "kling-3.0", label: "Kling 3.0", desc: "Advanced motion control with prompts" },
  { value: "wan-animate-move", label: "Wan Animate Move", desc: "Move subjects within scene" },
  { value: "wan-animate-replace", label: "Wan Animate Replace", desc: "Replace subjects with motion" },
]

/** Video Depth providers, in the order of `VIDEO_DEPTH_PROVIDERS` (a test pins it). */
export const VIDEO_DEPTH_MODELS: readonly { value: VideoDepthProvider; label: string; desc: string }[] = [
  { value: "video-depth-anything", label: "Video Depth Anything", desc: "Temporally consistent depth video. Colormaps, resolution, side-by-side. Up to 2,400 frames or 300 seconds." },
  { value: "depth-anything-frames", label: "Depth Anything (per frame)", desc: "Depth Anything v1 per frame. Grayscale or inferno; may flicker. Up to 80 seconds." },
]
