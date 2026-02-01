import Replicate from "replicate"
import { config } from "../../lib/config.js"

const replicate = new Replicate({ auth: config.REPLICATE_API_TOKEN })

export type AudioProvider = "tangoflux" | "tango" | "audioldm" | "bark"

interface ModelConfig {
  model: string
  promptParam: string
  durationParam?: string
  durationFormat?: "integer" | "string-enum"
  extraInput?: Record<string, unknown>
}

const AUDIO_DURATION_VALUES = ["2.5", "5.0", "7.5", "10.0", "12.5", "15.0", "17.5", "20.0"]

function closestAudioLdmDuration(seconds: number): string {
  const values = AUDIO_DURATION_VALUES.map(Number)
  const closest = values.reduce((prev, curr) =>
    Math.abs(curr - seconds) < Math.abs(prev - seconds) ? curr : prev
  )
  return closest.toFixed(1)
}

const AUDIO_MODEL_CONFIGS: Record<AudioProvider, ModelConfig> = {
  tangoflux: {
    model: "declare-lab/tangoflux:fcdc421786888a045329d7c4e1874764433a2516b21f4c34bd3da4e054d04cf9",
    promptParam: "prompt",
    durationParam: "duration",
    durationFormat: "integer",
  },
  tango: {
    model: "declare-lab/tango:740e4f5e59bd3b871c9e5b4efbff7ded516d40aa6abf4e95fd5e8dd149b7bc3f",
    promptParam: "prompt",
  },
  audioldm: {
    model: "haoheliu/audio-ldm:b61392adecdd660326fc9cfc5398182437dbe5e97b5decfb36e1a36de68b5b95",
    promptParam: "text",
    durationParam: "duration",
    durationFormat: "string-enum",
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

  const sanitizedPrompt = resolvedProvider === "audioldm" ? prompt.substring(0, 200) : prompt
  const input: Record<string, unknown> = {
    [cfg.promptParam]: sanitizedPrompt,
    ...cfg.extraInput,
  }
  if (duration !== undefined && cfg.durationParam) {
    if (cfg.durationFormat === "string-enum") {
      input[cfg.durationParam] = closestAudioLdmDuration(duration)
    } else {
      input[cfg.durationParam] = duration
    }
  }

  const output = await replicate.run(
    cfg.model as `${string}/${string}`,
    { input },
  )

  const resultUrl = String(output)
  console.log(`[textToAudio] Output: "${resultUrl}"`)
  return resultUrl
}
