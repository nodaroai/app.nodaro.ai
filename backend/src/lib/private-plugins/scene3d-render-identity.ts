import { createHash } from "node:crypto"
import { z } from "zod"
import { scene3DAnyPlanSchema, verifyScene3DPlanV2ContentHash, type Scene3DPlan } from "@nodaro/shared"
import type { PluginSceneRenderInput, PluginSceneRenderScope, PluginSceneRenderResult } from "./scene3d-render-contract.js"

const scopeSchema = z.object({ parentJobId: z.string().uuid(), userId: z.string().uuid(), key: z.string().min(1).max(128) })
const requestSchema = scopeSchema.extend({
  plan: scene3DAnyPlanSchema,
  assets: z.enum(["retained-revision", "owned-build"]),
  output: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("video") }).strict(),
    z.object({ kind: z.literal("stills"), frames: z.array(z.number().int().nonnegative()).min(1).max(24) }).strict(),
  ]),
}).strict()

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort()
      .map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`
  }
  return JSON.stringify(value)
}

export function sceneRenderChildId(input: PluginSceneRenderScope): string {
  const scope = scopeSchema.parse(input)
  const bytes = createHash("sha256").update(stable(scope)).digest().subarray(0, 16)
  bytes[6] = (bytes[6]! & 15) | 128
  bytes[8] = (bytes[8]! & 63) | 128
  const hex = bytes.toString("hex")
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`
}

export interface SceneRenderRequest {
  input: PluginSceneRenderInput & { plan: Scene3DPlan }
  childJobId: string
  inputHash: string
}

export async function validateSceneRenderRequest(raw: PluginSceneRenderInput): Promise<SceneRenderRequest> {
  // Zod clones validated fields before any asynchronous digest verification.
  const input = requestSchema.parse(raw)
  if (input.output.kind === "stills") {
    if (new Set(input.output.frames).size !== input.output.frames.length ||
        input.output.frames.some((frame) => frame >= input.plan.durationInFrames)) {
      throw new Error("Scene still frames must be unique and within the scene")
    }
    input.output.frames.sort((a, b) => a - b)
  }
  if (input.plan.schemaVersion === 2 && !await verifyScene3DPlanV2ContentHash(input.plan)) {
    throw new Error("Scene render content hash is invalid")
  }
  if (input.assets === "owned-build" && input.plan.schemaVersion !== 2) {
    throw new Error("An owned build requires a retained-asset scene")
  }
  return { input, childJobId: sceneRenderChildId(input), inputHash: createHash("sha256").update(stable(input)).digest("hex") }
}

const resultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("video"), videoUrl: z.string().url().refine((url) => /^https?:\/\//.test(url)),
    sceneRevisionId: z.string().uuid(), elapsedMs: z.number().int().nonnegative() }).strict(),
  z.object({ kind: z.literal("stills"), sceneRevisionId: z.string().uuid(), elapsedMs: z.number().int().nonnegative(),
    frames: z.array(z.object({ frame: z.number().int().nonnegative(), artifactId: z.string().uuid(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/), byteLength: z.number().int().positive().max(8 * 1024 * 1024) }).strict()).min(1).max(24) }).strict(),
])

export function validateSceneRenderResult(value: unknown, input: SceneRenderRequest["input"]): PluginSceneRenderResult {
  const result = resultSchema.parse(value)
  if (result.kind !== input.output.kind || result.sceneRevisionId !== input.plan.revisionId) {
    throw new Error("Scene render result does not match its request")
  }
  if (result.kind === "stills" && input.output.kind === "stills") {
    const requested = input.output.frames
    if (result.frames.length !== requested.length || result.frames.some((entry, index) => entry.frame !== requested[index]) ||
        new Set(result.frames.map((entry) => entry.artifactId)).size !== requested.length) {
      throw new Error("Scene still results do not match the requested frames")
    }
  }
  return result
}
