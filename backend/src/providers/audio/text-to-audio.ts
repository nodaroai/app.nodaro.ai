import Replicate from "replicate"
import { config } from "../../lib/config.js"

const replicate = new Replicate({ auth: config.REPLICATE_API_TOKEN })

export type AudioProvider = "tangoflux" | "tango" | "audioldm" | "bark"

interface ModelConfig {
  model: string
  promptParam: string
  durationParam?: string
  extraInput?: Record<string, unknown>
}

const AUDIO_MODEL_CONFIGS: Record<AudioProvider, ModelConfig> = {
  tangoflux: {
    model: "declare-lab/tangoflux",
    promptParam: "prompt",
    durationParam: "duration",
  },
  tango: {
    model: "declare-lab/tango",
    promptParam: "prompt",
    durationParam: "duration",
  },
  audioldm: {
    model: "haoheliu/audio-ldm",
    promptParam: "prompt",
    durationParam: "duration",
  },
  bark: {
    model: "suno-ai/bark",
    promptParam: "prompt",
  },
}

export async function textToAudio(
  prompt: string,
  provider?: AudioProvider,
  duration?: number,
): Promise<string> {
  const resolvedProvider = provider ?? "tangoflux"
  const cfg = AUDIO_MODEL_CONFIGS[resolvedProvider] ?? AUDIO_MODEL_CONFIGS.tangoflux
  console.log(`[textToAudio] Provider: ${resolvedProvider}, Model: ${cfg.model}`)
  console.log(`[textToAudio] Prompt: "${prompt}"`)

  const input: Record<string, unknown> = {
    [cfg.promptParam]: prompt,
    ...cfg.extraInput,
  }
  if (duration !== undefined && cfg.durationParam) {
    input[cfg.durationParam] = duration
  }

  const output = await replicate.run(
    cfg.model as `${string}/${string}`,
    { input },
  )

  const resultUrl = String(output)
  console.log(`[textToAudio] Output: "${resultUrl}"`)
  return resultUrl
}
