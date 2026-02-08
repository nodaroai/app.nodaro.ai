import Replicate from "replicate"
import { config } from "../../lib/config.js"

const replicate = new Replicate({ auth: config.REPLICATE_API_TOKEN })

export type AudioProvider = "tangoflux"

interface ModelConfig {
  model: string
  promptParam: string
  durationParam?: string
  durationFormat?: "integer"
  extraInput?: Record<string, unknown>
}

const AUDIO_MODEL_CONFIGS: Record<AudioProvider, ModelConfig> = {
  tangoflux: {
    model: "declare-lab/tangoflux:fcdc421786888a045329d7c4e1874764433a2516b21f4c34bd3da4e054d04cf9",
    promptParam: "prompt",
    durationParam: "duration",
    durationFormat: "integer",
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
