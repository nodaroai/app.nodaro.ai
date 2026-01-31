export interface ProviderInfo {
  readonly label: string
  readonly models: ReadonlyArray<string>
}

export type ProviderCategory = "image" | "video" | "voice" | "script"

export const PROVIDERS_CONFIG: Record<ProviderCategory, Record<string, ProviderInfo>> = {
  image: {
    "nano-banana": {
      label: "Nano Banana",
      models: ["gemini-2.5-flash-image", "gemini-2.5-pro-image"],
    },
    flux: {
      label: "Flux",
      models: ["flux-pro", "flux-dev"],
    },
    dalle: {
      label: "DALL-E",
      models: ["dall-e-3", "dall-e-2"],
    },
    midjourney: {
      label: "Midjourney",
      models: ["midjourney-v6", "midjourney-v5"],
    },
  },
  video: {
    veo: {
      label: "VEO",
      models: ["veo-3", "veo-3-fast"],
    },
    kling: {
      label: "Kling",
      models: ["kling-v1", "kling-v1-pro"],
    },
    runway: {
      label: "Runway",
      models: ["gen-3-alpha", "gen-3-alpha-turbo"],
    },
    pika: {
      label: "Pika",
      models: ["pika-1.0", "pika-1.5"],
    },
  },
  voice: {
    elevenlabs: {
      label: "ElevenLabs",
      models: ["eleven_multilingual_v2", "eleven_turbo_v2"],
    },
    playht: {
      label: "PlayHT",
      models: ["playht-2.0", "playht-2.0-turbo"],
    },
    azure: {
      label: "Azure TTS",
      models: ["azure-neural", "azure-standard"],
    },
  },
  script: {
    claude: {
      label: "Claude",
      models: ["claude-3-opus", "claude-3-sonnet", "claude-3-haiku"],
    },
    gpt: {
      label: "GPT",
      models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"],
    },
    gemini: {
      label: "Gemini",
      models: ["gemini-2.5-flash", "gemini-2.5-pro"],
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
