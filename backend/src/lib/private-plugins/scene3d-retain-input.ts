import { createHash } from "node:crypto"
import { z } from "zod"
import type { PluginSceneArtifactToolkit } from "./scene3d-artifact-contract.js"
import { Scene3DArtifactError } from "../../services/scene3d-artifacts/types.js"
import { authorizeScene3DInputArtifact } from "./scene3d-input-authority.js"
import { writeScene3DInputGlb } from "./scene3d-write-json.js"

const schema = z.object({ jobId: z.uuid(), userId: z.uuid(), revisionId: z.uuid(), artifactId: z.uuid(),
  sourceRevisionId: z.uuid(), asset: z.object({ assetId: z.uuid(), kind: z.literal("glb"),
    sha256: z.string().regex(/^[a-f0-9]{64}$/), byteLength: z.number().int().min(12).max(64 * 1024 * 1024),
  }).strict(),
}).strict()

type RetainInput = NonNullable<PluginSceneArtifactToolkit["retainInput"]>

/** Copy bytes through the same reservation/receipt path as other private outputs. */
export async function retainScene3DInput(
  toolkit: Pick<PluginSceneArtifactToolkit, "grant" | "receive" | "grantInput">,
  raw: Parameters<RetainInput>[0],
  options: { signal?: AbortSignal; authorizeJob(input: { jobId: string; userId: string }): Promise<unknown>;
    authorizeSource?: typeof authorizeScene3DInputArtifact; fetch?: typeof fetch },
): ReturnType<RetainInput> {
  options.signal?.throwIfAborted()
  const parsed = schema.safeParse(raw)
  if (!parsed.success || !toolkit.grantInput) throw new Scene3DArtifactError("SCENE_ASSET_INVALID", "Scene input retention is unavailable")
  const input = parsed.data
  const active = async () => {
    options.signal?.throwIfAborted()
    await options.authorizeJob(input)
    const source = await (options.authorizeSource ?? authorizeScene3DInputArtifact)(input.userId, input.sourceRevisionId, input.asset.assetId)
    options.signal?.throwIfAborted()
    if (!source.ok) throw new Scene3DArtifactError("SCENE_ASSET_MISSING", "Scene input is unavailable")
    if (source.artifact.sha256 !== input.asset.sha256 || source.artifact.byteLength !== input.asset.byteLength ||
        (source.artifact.expiresAt !== null && !(Date.parse(source.artifact.expiresAt) > Date.now()))) {
      throw new Scene3DArtifactError("SCENE_ASSET_INVALID", "Scene input no longer matches its receipt")
    }
  }
  await active()
  const grant = await toolkit.grantInput({ jobId: input.jobId, userId: input.userId, sourceRevisionId: input.sourceRevisionId,
    asset: input.asset, expiresInSeconds: 900 }, { signal: options.signal })
  if (grant.assetId !== input.asset.assetId || grant.kind !== "glb" || grant.sha256 !== input.asset.sha256 ||
      grant.byteLength !== input.asset.byteLength || grant.fetch.method !== "GET") {
    throw new Scene3DArtifactError("SCENE_ASSET_INVALID", "Scene input grant differs from its receipt")
  }
  options.signal?.throwIfAborted()
  const timeout = AbortSignal.timeout(60_000)
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
  let response: Response
  try {
    response = await (options.fetch ?? fetch)(grant.fetch.url, { method: "GET", headers: grant.fetch.headers,
      redirect: "error", signal })
  } catch {
    options.signal?.throwIfAborted()
    throw new Scene3DArtifactError("SCENE_STORAGE_FAILED", "Reading the scene input failed")
  }
  const declared = response.headers.get("content-length")
  if (!response.ok || !response.body || (declared !== null && Number(declared) !== input.asset.byteLength)) {
    await response.body?.cancel()
    throw new Scene3DArtifactError("SCENE_STORAGE_FAILED", "Reading the scene input failed")
  }
  const reader = response.body.getReader(), chunks: Buffer[] = [], hash = createHash("sha256")
  let length = 0
  try {
    while (true) {
      signal.throwIfAborted()
      const { done, value } = await reader.read()
      signal.throwIfAborted()
      if (done) break
      length += value.byteLength
      if (length > input.asset.byteLength) throw new Scene3DArtifactError("SCENE_ASSET_INVALID", "Scene input exceeds its receipt")
      const bytes = Buffer.from(value)
      hash.update(bytes); chunks.push(bytes)
    }
  } catch (error) {
    options.signal?.throwIfAborted()
    if (error instanceof Scene3DArtifactError) throw error
    throw new Scene3DArtifactError("SCENE_STORAGE_FAILED", "Reading the scene input failed")
  } finally {
    await reader.cancel().catch(() => {})
  }
  if (length !== input.asset.byteLength || hash.digest("hex") !== input.asset.sha256) {
    throw new Scene3DArtifactError("SCENE_ASSET_INVALID", "Scene input no longer matches its receipt")
  }
  await active()
  const copied = await writeScene3DInputGlb(toolkit, { jobId: input.jobId, userId: input.userId, revisionId: input.revisionId,
    artifactId: input.artifactId, kind: "input-glb", bytes: Buffer.concat(chunks, length) }, options)
  await active()
  return copied
}
