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
    model: "declare-lab/tangoflux:fcdc421786888a045329d7c4e1874764433a2516b21f4c34bd3da4e054d04cf9",
    promptParam: "prompt",
    durationParam: "duration",
  },
  tango: {
    model: "declare-lab/tango:740e4f5e59bd3b871c9e5b4efbff7ded516d40aa6abf4e95fd5e8dd149b7bc3f",
    promptParam: "prompt",
    durationParam: "duration",
  },
  audioldm: {
    model: "haoheliu/audio-ldm:b61392adecdd660326fc9cfc5398182437dbe5e97b5decfb36e1a36de68b5b95",
    promptParam: "text",
    durationParam: "duration",
  },
  bark: {
    model: "suno-ai/bark:b76242b40d67c76ab6742e987628a2a9ac019e11d56ab96c4e91ce03b79b2787",
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
