import { createHash } from "node:crypto"
import type { PluginSceneArtifactToolkit, PluginSceneArtifactUpload } from "./scene3d-artifact-contract.js"

const JSON_KINDS = new Set(["source-json", "build-manifest", "validation-report", "camera-track-json"])

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
    throw new Error("Scene JSON upload could not be confirmed")
  }
  await response.body?.cancel()
  if (!response.ok && response.status !== 412) throw new Error("Scene JSON upload failed")
  options?.signal?.throwIfAborted()
  const receipt = await toolkit.receive(scope)
  if (receipt.sha256 !== sha256 || receipt.byteLength !== bytes.length ||
      receipt.kind !== input.kind || receipt.objectKey !== grant.key || receipt.artifactId !== input.artifactId) {
    throw new Error("Scene JSON artifact differs from the immutable upload")
  }
  options?.signal?.throwIfAborted()
  return receipt
}
