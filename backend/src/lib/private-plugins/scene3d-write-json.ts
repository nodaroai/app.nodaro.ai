import { createHash } from "node:crypto"
import type { PluginSceneArtifactToolkit, PluginSceneArtifactUpload } from "./scene3d-artifact-contract.js"
import { Scene3DArtifactError } from "../../services/scene3d-artifacts/types.js"
import { assertScene3DArtifactMagic } from "../../services/scene3d-artifacts/receipt.js"

const JSON_KINDS = new Set(["source-json", "build-manifest", "validation-report", "camera-track-json"])

/** Adopt bytes already rendered under this immutable child/frame identity. */
export async function receiveScene3DPngIfPresent(
  toolkit: Pick<PluginSceneArtifactToolkit, "receive">,
  input: Omit<PluginSceneArtifactUpload, "kind">,
) {
  try {
    const receipt = await toolkit.receive(input)
    if (receipt.artifactId !== input.artifactId || receipt.kind !== "poster" ||
        !/^[a-f0-9]{64}$/.test(receipt.sha256) || receipt.byteLength < 33 || receipt.byteLength > 8 * 1024 * 1024) {
      throw new Scene3DArtifactError("SCENE_ASSET_INVALID", "Stored scene frame has an invalid receipt")
    }
    return receipt
  } catch (error) {
    if (error instanceof Scene3DArtifactError && error.code === "SCENE_ASSET_MISSING") return null
    throw error
  }
}

/** Exact-key conditional upload, followed by a host readback rather than trusting the PUT. */
export async function writeScene3DJson(
  toolkit: Pick<PluginSceneArtifactToolkit, "grant" | "receive">,
  input: PluginSceneArtifactUpload & { bytes: Uint8Array },
  options?: { signal?: AbortSignal; fetch?: typeof fetch },
) {
  options?.signal?.throwIfAborted()
  if (!JSON_KINDS.has(input.kind) || !(input.bytes instanceof Uint8Array) ||
      input.bytes.byteLength === 0 || input.bytes.byteLength > 8 * 1024 * 1024) {
    throw new Error("Scene JSON artifact exceeds its kind or size limit")
  }
  // Snapshot before awaiting so a producer cannot change bytes between hashing and upload.
  const bytes = Buffer.from(input.bytes)
  try { JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) }
  catch { throw new Error("Scene JSON artifact is not valid JSON") }
  return writeScene3DBytes(toolkit, { ...input, bytes }, options)
}

/** Trusted renderer PNG output; bounded bytes still pass the host's receipt validator. */
export async function writeScene3DPng(
  toolkit: Pick<PluginSceneArtifactToolkit, "grant" | "receive">,
  input: PluginSceneArtifactUpload & { bytes: Uint8Array },
  options?: { signal?: AbortSignal; fetch?: typeof fetch },
) {
  options?.signal?.throwIfAborted()
  const bytes = Buffer.from(input.bytes)
  if (input.kind !== "poster" || bytes.length < 33 || bytes.length > 8 * 1024 * 1024 ||
      !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ||
      bytes.toString("ascii",12,16) !== "IHDR" || bytes.readUInt32BE(16) < 1 || bytes.readUInt32BE(16) > 1920 ||
      bytes.readUInt32BE(20) < 1 || bytes.readUInt32BE(20) > 1920) throw new Error("Scene still is not a bounded PNG")
  return writeScene3DBytes(toolkit, { ...input, bytes }, options)
}

/** Verified retained input; the copy still uses a reservation and independent host readback. */
export async function writeScene3DInputGlb(
  toolkit: Pick<PluginSceneArtifactToolkit, "grant" | "receive">,
  input: PluginSceneArtifactUpload & { bytes: Uint8Array },
  options?: { signal?: AbortSignal; fetch?: typeof fetch },
) {
  options?.signal?.throwIfAborted()
  if (input.kind !== "input-glb" || !(input.bytes instanceof Uint8Array) || input.bytes.length > 64 * 1024 * 1024) {
    throw new Scene3DArtifactError("SCENE_ASSET_INVALID", "Scene input exceeds its kind or byte limit")
  }
  const bytes = Buffer.from(input.bytes)
  assertScene3DArtifactMagic(input.kind, bytes.subarray(0, 16), bytes.length)
  return writeScene3DBytes(toolkit, { ...input, bytes }, options)
}

async function writeScene3DBytes(
  toolkit: Pick<PluginSceneArtifactToolkit, "grant" | "receive">,
  input: PluginSceneArtifactUpload & { bytes: Buffer<ArrayBuffer> },
  options?: { signal?: AbortSignal; fetch?: typeof fetch },
) {
  const { bytes } = input
  const sha256 = createHash("sha256").update(bytes).digest("hex")
  const { bytes: _bytes, ...scope } = input
  const grant = await toolkit.grant(scope)
  options?.signal?.throwIfAborted()
  const timeout = AbortSignal.timeout(30_000)
  const signal = options?.signal ? AbortSignal.any([options.signal, timeout]) : timeout
  let response: Response
  try {
    response = await (options?.fetch ?? fetch)(grant.url, {
      method: "PUT", headers: grant.headers, body: bytes, redirect: "error", signal,
    })
  } catch {
    options?.signal?.throwIfAborted()
    throw new Error("Scene artifact upload could not be confirmed")
  }
  await response.body?.cancel()
  if (!response.ok && response.status !== 412) throw new Error("Scene artifact upload failed")
  options?.signal?.throwIfAborted()
  const receipt = await toolkit.receive(scope)
  if (receipt.kind !== input.kind || receipt.objectKey !== grant.key || receipt.artifactId !== input.artifactId ||
      !/^[a-f0-9]{64}$/.test(receipt.sha256) || !Number.isSafeInteger(receipt.byteLength) || receipt.byteLength <= 0) {
    throw new Error("Scene artifact differs from the immutable upload")
  }
  // Chromium may encode the same requested frame differently after a restart. The existing
  // owned frame wins; JSON authoring records still require byte-for-byte equality on replay.
  const existingFrame = response.status === 412 && input.kind === "poster" && receipt.byteLength >= 33 && receipt.byteLength <= 8 * 1024 * 1024
  if (!existingFrame && (receipt.sha256 !== sha256 || receipt.byteLength !== bytes.length)) {
    throw new Error("Scene artifact differs from the immutable upload")
  }
  options?.signal?.throwIfAborted()
  return receipt
}
