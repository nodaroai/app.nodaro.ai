export interface ProviderInfo {
  readonly label: string
  readonly models: ReadonlyArray<string>
}

export type ProviderCategory = "image" | "video" | "voice" | "script"

export const PROVIDERS_CONFIG: Record<ProviderCategory, Record<string, ProviderInfo>> = {
  image: {
    dalle: {
      label: "DALL-E",
      models: ["dall-e-3", "dall-e-2"],
    },
    flux: {
      label: "Flux",
      models: ["flux-pro", "flux-dev"],
    },
    midjourney: {
      label: "Midjourney",
      models: ["midjourney-v6", "midjourney-v5"],
    },
    "nano-banana": {
      label: "Nano Banana",
      models: ["gemini-2.5-flash-image", "gemini-2.5-pro-image"],
    },
  },
  video: {
    kling: {
      label: "Kling",
      models: ["kling-v1", "kling-v1-pro"],
    },
    pika: {
      label: "Pika",
      models: ["pika-1.0", "pika-1.5"],
    },
    runway: {
      label: "Runway",
      models: ["gen-3-alpha", "gen-3-alpha-turbo"],
    },
    veo3: {
      label: "VEO 3.1",
      models: ["veo-3", "veo-3-fast"],
    },
  },
  voice: {
    "elevenlabs-multilingual": {
      label: "ElevenLabs Multilingual v2",
      models: ["elevenlabs/text-to-speech-multilingual-v2"],
    },
    "elevenlabs-turbo": {
      label: "ElevenLabs Turbo v2.5",
      models: ["elevenlabs/text-to-speech-turbo-2-5"],
    },
  },
  script: {
    claude: {
      label: "Claude",
      models: ["claude-3-opus", "claude-3-sonnet", "claude-3-haiku"],
    },
    gemini: {
      label: "Gemini",
      models: ["gemini-2.5-flash", "gemini-2.5-pro"],
    },
    gpt: {
      label: "GPT",
      models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"],
    },
  },
}

export function getProviders(category: ProviderCategory): ReadonlyArray<string> {
  return Object.keys(PROVIDERS_CONFIG[category])
}

export function getProviderLabel(category: ProviderCategory, provider: string): string {
  return PROVIDERS_CONFIG[category][provider]?.label ?? provider
}

export function getModels(category: ProviderCategory, provider: string): ReadonlyArray<string> {
  return PROVIDERS_CONFIG[category][provider]?.models ?? []
}

export function getFirstProvider(category: ProviderCategory): string {
  const providers = getProviders(category)
  return providers[0] ?? ""
}

export function getFirstModel(category: ProviderCategory, provider: string): string {
  const models = getModels(category, provider)
  return models[0] ?? ""
}
