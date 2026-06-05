export interface FactoryPreset {
  /** Stable slug "<nodeType>/<kebab-name>" — used as a React key and in exports. */
  readonly id: string
  readonly name: string
  readonly description?: string
  /** Capture-shaped config (no label / fieldMappings / runtime keys). */
  readonly data: Readonly<Record<string, unknown>>
}

/**
 * System/factory presets shipped with the app. Code-defined (like the picker catalogs) so they are
 * typed, testable, versioned with the app, and available in every edition without a DB seed.
 *
 * Additive: the preset system works for ALL node types; these are curated starting points for the
 * highest-traffic nodes. Each preset's `data` uses only fields that exist on that node and values
 * valid for the node's route Zod schema (verified against `model-options.ts` / route schemas).
 * Presets set `provider` plus a few high-signal knobs; the config panel's provider-change fail-safe
 * derives any provider-dependent field (e.g. `model`) on apply.
 */
export const FACTORY_PRESETS: Readonly<Record<string, readonly FactoryPreset[]>> = {
  "generate-image": [
    {
      id: "generate-image/cinematic-portrait",
      name: "Cinematic Portrait",
      description: "Moody, shallow-depth portrait look.",
      data: {
        provider: "nano-banana-pro",
        aspectRatio: "9:16",
        prompt:
          "cinematic portrait, shallow depth of field, soft rim lighting, film grain, 85mm lens",
        negativePrompt: "lowres, deformed, extra fingers, watermark, text",
      },
    },
    {
      id: "generate-image/product-shot",
      name: "Product Shot (white bg)",
      description: "Clean e-commerce product photo on white.",
      data: {
        provider: "nano-banana-pro",
        aspectRatio: "1:1",
        prompt:
          "studio product photograph on seamless white background, soft even lighting, high detail, centered",
        negativePrompt: "clutter, shadow, reflection, text, watermark",
      },
    },
  ],
  "generate-video": [
    {
      id: "generate-video/subtle-motion",
      name: "Subtle Motion",
      description: "Gentle, natural movement.",
      data: {
        aspectRatio: "16:9",
        prompt: "subtle natural motion, gentle camera drift, cinematic",
      },
    },
  ],
  "text-to-speech": [
    {
      id: "text-to-speech/narrator-calm",
      name: "Narrator (calm)",
      description: "Even, measured narration.",
      data: { speed: 1, stability: 0.6, similarityBoost: 0.75, style: 0 },
    },
  ],
  "generate-music": [
    {
      id: "generate-music/ambient-cinematic",
      name: "Ambient Cinematic",
      description: "Atmospheric instrumental bed.",
      data: { genre: "cinematic", mood: "atmospheric", instrumental: true },
    },
  ],
  "llm-chat": [
    {
      id: "llm-chat/concise-assistant",
      name: "Concise Assistant",
      description: "Short, direct answers.",
      data: {
        systemPrompt: "You are a concise assistant. Answer in 1-3 sentences. No preamble.",
        temperature: 0.3,
      },
    },
    {
      id: "llm-chat/json-extractor",
      name: "JSON Extractor",
      description: "Returns strict JSON only.",
      data: {
        systemPrompt:
          "Extract the requested fields and return ONLY valid minified JSON. No prose, no code fences.",
        temperature: 0,
      },
    },
  ],
}

export function getFactoryPresets(nodeType: string): readonly FactoryPreset[] {
  return FACTORY_PRESETS[nodeType] ?? []
}
