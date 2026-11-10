// @test-watches backend/src/services/workflow-engine/payload-builder.ts frontend/src/nodes/** backend/src/nodes/**
/**
 * TOTALITY for "an engine name is not judged as a model id"
 * (lib/provider-model.ts). A node type whose `provider` vocabulary holds a
 * value that is not the id of a model the node runs either maps it
 * (`PROVIDER_MODEL_OF_NODE`: the model it runs, or none), or is listed below
 * with the reason the value is the node's model id after all. Without this, a
 * value that shares its id with an unrelated model (Generate Music's
 * `minimax`, Motion Transfer's `kling`) refuses the node wherever that other
 * model is withheld or switched off, while the model it runs goes unjudged.
 *
 * A value is the id of a model the node runs when it is an LLM id, or a
 * catalog id with a mode of this node's models — the modes of every catalog
 * entry the catalog's own node targets (`modelToNodeTarget`) send to the
 * node, or to the node whose models it runs (`RUNS_MODELS_OF`).
 *
 * Vocabularies: every node registry descriptor's `providers`, and for the
 * node types it lists none for, the shared enum their route validates
 * (`DECLARED_VOCABULARIES`). Every node type whose workflow build reads its
 * `provider` must have one.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"
import { LLM_MODELS } from "@nodaro/shared/llm-models"
import {
  DIALOGUE_PROVIDERS,
  EXTEND_VIDEO_PROVIDERS,
  FACE_SWAP_PROVIDERS,
  IMAGE_GEN_PROVIDERS,
  IMAGE_TO_VIDEO_PROVIDERS,
  MODIFY_IMAGE_PROVIDERS,
  MOTION_TRANSFER_PROVIDERS,
  QA_CHECK_PROVIDERS,
  SCRIPT_PROVIDERS,
  TEXT_TO_AUDIO_PROVIDERS,
  TEXT_TO_VIDEO_PROVIDERS,
  TTS_PROVIDERS,
  UPSCALE_IMAGE_PROVIDERS,
  VIDEO_TO_VIDEO_NODE_PROVIDERS,
  VIDEO_UPSCALE_PROVIDERS,
  modelToNodeTarget,
} from "@nodaro/shared/models"
import { NODE_REGISTRY } from "../node-registry.js"
import { GATEABLE_MODEL_IDS } from "../availability-override.js"
import { PROVIDER_MODEL_OF_NODE, providerModelOf } from "../provider-model.js"

/** Node types the registry lists no `providers` for, with the enum their route validates `provider` against. */
const DECLARED_VOCABULARIES: Readonly<Record<string, readonly string[]>> = {
  "generate-image": IMAGE_GEN_PROVIDERS,
  "modify-image": MODIFY_IMAGE_PROVIDERS,
  "upscale-image": UPSCALE_IMAGE_PROVIDERS,
  "image-to-video": IMAGE_TO_VIDEO_PROVIDERS,
  "text-to-video": TEXT_TO_VIDEO_PROVIDERS,
  "video-to-video": VIDEO_TO_VIDEO_NODE_PROVIDERS,
  "extend-video": EXTEND_VIDEO_PROVIDERS,
  "motion-transfer": MOTION_TRANSFER_PROVIDERS,
  "video-upscale": VIDEO_UPSCALE_PROVIDERS,
  "face-swap": FACE_SWAP_PROVIDERS,
  "text-to-speech": TTS_PROVIDERS,
  "text-to-audio": TEXT_TO_AUDIO_PROVIDERS,
  "text-to-dialogue": DIALOGUE_PROVIDERS,
  "generate-script": SCRIPT_PROVIDERS,
  "qa-check": QA_CHECK_PROVIDERS,
}

/** Node types that run another node type's models (the catalog sends each model to one node). */
const RUNS_MODELS_OF: Readonly<Record<string, string>> = {
  "image-to-video": "generate-video",
  "text-to-video": "generate-video",
  "generate-video-pro": "generate-video",
  "edit-video-pro": "generate-video",
  "reference-board": "generate-image",
  "face": "generate-image",
  "character": "generate-image",
  "object": "generate-image",
  "creature": "generate-image",
  "location": "generate-image",
  "scene": "generate-image",
}

/**
 * Node types whose vocabulary holds values the catalog does not send to them,
 * that are nonetheless the ids of the models they run — judged as they are.
 */
const PROVIDER_IS_ITS_MODEL: Readonly<Record<string, string>> = {
  "lip-sync": "each value is the model it runs: lip-sync models outside the catalog, and video models it runs in lip-sync mode under their own ids",
  "extend-video": "an extension runs the catalog model it names (LTX 2.3 Pro's extend task is `ltx-2.3-pro`)",
  "video-retake": "it runs LTX 2.3 Pro's retake task, the catalog's `ltx-2.3-pro`",
  "modify-image": "Flux Fill is its own model outside the catalog: only an explicit `models.deny` names it",
  "face-swap": "its engine is its own model outside the catalog: only an explicit `models.deny` names it",
  "video-sfx": "its engine is its own model outside the catalog: only an explicit `models.deny` names it",
  "switchx": "its engine is its own model outside the catalog: only an explicit `models.deny` names it",
  "ai-avatar": "its vendor is its own model outside the catalog: only an explicit `models.deny` names it",
  "cinematic-avatar": "its vendor is its own model outside the catalog: only an explicit `models.deny` names it",
  "video-mask": "its segmentation models are outside the catalog: only an explicit `models.deny` names them",
  "generate-mask": "its segmentation model is outside the catalog: only an explicit `models.deny` names it",
}

const LLM_IDS: ReadonlySet<string> = new Set(LLM_MODELS.map((m) => m.id))

/** The catalog modes of the models each node type runs, from the catalog's own node targets. */
const MODES_OF_NODE: ReadonlyMap<string, ReadonlySet<string>> = (() => {
  const byNode = new Map<string, Set<string>>()
  for (const entry of Object.values(MODEL_CATALOG)) {
    const target = modelToNodeTarget(entry.id)
    if (!target) continue
    const modes = byNode.get(target.nodeType) ?? new Set<string>()
    for (const m of entry.modes) modes.add(m)
    byNode.set(target.nodeType, modes)
  }
  return byNode
})()

function runsModel(type: string, value: string): boolean {
  if (LLM_IDS.has(value)) return true
  const entry = MODEL_CATALOG[value]
  if (!entry) return false
  const modes = MODES_OF_NODE.get(RUNS_MODELS_OF[type] ?? type)
  return entry.modes.some((m) => modes?.has(m) === true)
}

const vocabularies: ReadonlyMap<string, readonly string[]> = new Map([
  ...NODE_REGISTRY.filter((d) => Array.isArray(d.providers) && d.providers.length > 0).map((d) => [d.type, d.providers!] as const),
  ...Object.entries(DECLARED_VOCABULARIES),
])

/** Values of a vocabulary that are not the id of a model the node runs: `type → values`. */
const notTheirModels: ReadonlyMap<string, readonly string[]> = new Map(
  [...vocabularies]
    .map(([type, values]) => [type, values.filter((v) => !runsModel(type, v))] as const)
    .filter(([, values]) => values.length > 0),
)

/** The node types whose case in buildPayload's switch reads the node's provider. */
function buildsReadingProvider(): string[] {
  const src = readFileSync(join(__dirname, "..", "..", "services", "workflow-engine", "payload-builder.ts"), "utf8")
  const lines = src.split("\n")
  const out = new Set<string>()
  let labels: string[] = []
  let body: string[] = []
  const flush = () => {
    if (labels.length && body.some((l) => /data\.provider|dispatchProvider|effectiveDispatchProvider\(/.test(l))) for (const t of labels) out.add(t)
  }
  for (const line of lines) {
    const label = /^ {4}case "([a-z0-9-]+)":/.exec(line)
    if (label) {
      if (body.length > 0) {
        flush()
        labels = []
        body = []
      }
      labels.push(label[1]!)
      continue
    }
    if (/^ {4}default:/.test(line)) {
      flush()
      labels = []
      body = []
      continue
    }
    if (labels.length) body.push(line)
  }
  flush()
  return [...out].sort()
}

describe("every node type's provider vocabulary is the ids of the models it runs, or is mapped", () => {
  it("read the vocabularies (the registry's and the declared enums)", () => {
    expect(vocabularies.size).toBeGreaterThan(25)
    expect(vocabularies.get("generate-music")).toEqual(expect.arrayContaining(["minimax"]))
    expect(vocabularies.get("motion-transfer")).toEqual(expect.arrayContaining(["kling"]))
  })

  it("the engine names that share an id with another model are found (the census can see the bug it guards)", () => {
    expect(notTheirModels.get("generate-music")).toContain("minimax")
    expect(notTheirModels.get("motion-transfer")).toContain("kling")
  })

  it("each node type with such a value maps it or says why it is its model", () => {
    const undeclared = [...notTheirModels]
      .filter(([type]) => !Object.hasOwn(PROVIDER_MODEL_OF_NODE, type) && !Object.hasOwn(PROVIDER_IS_ITS_MODEL, type))
      .map(([type, values]) => `${type}: ${values.join(", ")}`)
    expect(undeclared).toEqual([])
  })

  it("a mapping answers a model a restriction can name, the value itself, or none — for every value", () => {
    const wrong: string[] = []
    for (const type of Object.keys(PROVIDER_MODEL_OF_NODE)) {
      for (const value of vocabularies.get(type) ?? []) {
        const model = providerModelOf(type, value)
        if (model !== null && model !== value && !GATEABLE_MODEL_IDS.has(model)) wrong.push(`${type}: ${value} → ${model}`)
      }
    }
    expect(wrong).toEqual([])
  })

  it("no declaration is stale: each names a node type with a value that is not its model", () => {
    const flagged = new Set(notTheirModels.keys())
    expect([...Object.keys(PROVIDER_MODEL_OF_NODE), ...Object.keys(PROVIDER_IS_ITS_MODEL)].filter((t) => !flagged.has(t))).toEqual([])
  })

  it("every node type whose workflow build reads its provider has a vocabulary here", () => {
    const reads = buildsReadingProvider()
    expect(reads).toEqual(expect.arrayContaining(["generate-music", "motion-transfer", "generate-script"]))
    expect(reads.filter((t) => !vocabularies.has(t) && !Object.hasOwn(RUNS_MODELS_OF, t))).toEqual([])
  })
})
