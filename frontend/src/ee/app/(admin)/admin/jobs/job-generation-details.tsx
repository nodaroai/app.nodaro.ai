import { getModel } from "@nodaro/shared/model-catalog"

const fields: readonly [string, readonly string[], string?][] = [
  ["Resolution", ["resolution"]],
  ["Requested duration", ["duration", "durationSec", "durationSeconds"], " sec"],
  ["Audio duration", ["audioDurationSec"], " sec"],
  ["Aspect ratio", ["aspectRatio", "aspect_ratio"]],
  ["Frame rate", ["fps", "frameRate"], " fps"],
  ["Quality", ["quality"]],
  ["Generate audio", ["generateAudio", "generate_audio"]],
  ["Seed", ["seed"]],
  ["Steps", ["inferenceSteps", "numInferenceSteps"]],
  ["Guidance", ["guidanceScale"]],
  ["Target language", ["targetLanguage", "targetLang"]],
  ["Sync mode", ["syncMode"]],
]

function scalar(input: Record<string, unknown>, keys: readonly string[]): string | number | boolean | undefined {
  for (const key of keys) {
    const value = input[key]
    if (typeof value === "string" && value.trim()) return value
    if (typeof value === "number" && Number.isFinite(value)) return value
    if (typeof value === "boolean") return value
  }
}

/** Only recorded generation parameters: no guessed defaults or request payload dumps. */
export function JobGenerationDetails({ input }: { input: Record<string, unknown> | null }) {
  if (!input) return null
  const modelId = scalar(input, ["model", "modelId", "modelIdentifier", "provider"])
  const model = typeof modelId === "string" ? getModel(modelId) : undefined
  const values = fields.flatMap(([label, keys, suffix]) => {
    const value = scalar(input, keys)
    if (value === undefined) return []
    const text = typeof value === "boolean" ? (value ? "Yes" : "No")
      : `${value}${suffix && (typeof value === "number" || /^\d+(\.\d+)?$/.test(value)) ? suffix : ""}`
    return [{ label, text }]
  })
  return <>
    {typeof modelId === "string" && <div className="min-w-0">
      <span className="text-muted-foreground">Model</span>
      <p className="break-words">{model?.label ?? modelId}</p>
      {model && model.label !== modelId && <p className="break-all font-mono text-xs text-muted-foreground">{modelId}</p>}
    </div>}
    {values.map(({label,text}) => <div key={label} className="min-w-0">
      <span className="text-muted-foreground">{label}</span>
      <p className="break-words">{text}</p>
    </div>)}
  </>
}
