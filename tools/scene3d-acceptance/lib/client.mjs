/**
 * The ONE module that touches credentials or the network.
 *
 * Everything else in `lib/` is pure, which is what lets the unit tests cover
 * the measurement code with no network and no key. Keep it that way: if a
 * subcommand needs a new HTTP call, it goes here or in the subcommand, never
 * into a module a test imports.
 *
 * The SDK import is DYNAMIC, inside the factory. Two reasons, both load-bearing:
 * `--help` and `--dry-run` must work with no credentials and no built packages,
 * and the repo's tool self-test CI job runs `node --test tools/__tests__/*.mjs`
 * on a bare checkout with no `npm ci` — a top-level `import "@nodaro/sdk"`
 * anywhere in this tree turns every one of those tests red.
 */

export const CLIENT_LABEL = "sdk/scene3d-acceptance"

export class HarnessError extends Error {
  constructor(message, { code = "harness_error", hint } = {}) {
    super(message)
    this.name = "HarnessError"
    this.code = code
    this.hint = hint ?? null
  }
}

/**
 * Build an authenticated client.
 *
 * The CLI profiles under `~/.config/nodaro/` are deliberately NOT read: this
 * harness spends real credits, and "it picked up a profile I forgot about" is
 * not a failure mode worth having. The key comes from the environment of the
 * process that meant to run it.
 */
export async function makeClient({ baseUrl } = {}) {
  const apiKey = process.env.NODARO_API_KEY
  const resolvedBase = baseUrl ?? process.env.NODARO_BASE_URL
  if (!apiKey) {
    throw new HarnessError("NODARO_API_KEY is not set", {
      code: "no_credentials",
      hint: "export NODARO_API_KEY=... (never pass a key on the command line — it lands in shell history)",
    })
  }
  if (!resolvedBase) {
    throw new HarnessError("NODARO_BASE_URL is not set", {
      code: "no_base_url",
      hint: "export NODARO_BASE_URL=https://next.nodaro.ai for staging",
    })
  }
  const { createClient, StaticTokenAuth } = await import("@nodaro/sdk")
  const client = createClient({
    baseUrl: resolvedBase.replace(/\/$/, ""),
    auth: new StaticTokenAuth(apiKey),
    clientLabel: CLIENT_LABEL,
    timeoutMs: 120_000,
  })
  return { client, baseUrl: resolvedBase, apiKey }
}

/**
 * What this deployment can serve, and a hard refusal when it cannot.
 *
 * Availability is a property of the DEPLOYMENT, not of the contract, and the
 * platform's own rule is that an unavailable engine is refused rather than
 * downgraded. The harness mirrors that: it exits `unavailable` with a receipt
 * instead of quietly measuring the Basic lane and reporting it as Pro.
 */
export async function readCapabilities(client) {
  const caps = await client.scene3d.capabilities()
  return {
    raw: caps,
    proAvailable: caps?.pro?.available === true,
    proEngines: caps?.pro?.engines ?? [],
    proAspectRatios: caps?.pro?.aspectRatios ?? [],
    proQualityProfiles: caps?.pro?.qualityProfiles ?? [],
    proStyles: caps?.pro?.styles ?? [],
    proMaxRepairPasses: typeof caps?.pro?.maxRepairPasses === "number" ? caps.pro.maxRepairPasses : null,
    advancedEngines: caps?.advanced?.engines ?? [],
    advancedSchemaVersions: caps?.advanced?.sceneSchemaVersions ?? [],
    advancedMaxRepairPasses: typeof caps?.advanced?.maxRepairPasses === "number" ? caps.advanced.maxRepairPasses : null,
    advancedVersion: caps?.advanced?.version ?? null,
    basicSchemaVersions: caps?.basic?.sceneSchemaVersions ?? [],
  }
}

export function requireProCapability(caps, { aspectRatio, repairPasses } = {}) {
  if (!caps.proAvailable) {
    throw new HarnessError("this deployment cannot serve pro-3d-render", {
      code: "capability_unavailable",
      hint: "scene3d.capabilities().pro.available is false — nothing to measure here",
    })
  }
  if (aspectRatio && caps.proAspectRatios.length > 0 && !caps.proAspectRatios.includes(aspectRatio)) {
    throw new HarnessError(`this deployment does not offer aspect ratio ${aspectRatio}`, {
      code: "capability_unavailable",
      hint: `offered: ${caps.proAspectRatios.join(", ")}`,
    })
  }
  if (typeof repairPasses === "number" && caps.proMaxRepairPasses !== null && repairPasses > caps.proMaxRepairPasses) {
    throw new HarnessError(`repair budget ${repairPasses} exceeds this deployment's max of ${caps.proMaxRepairPasses}`, {
      code: "capability_unavailable",
    })
  }
}

export function requireAdvancedEngine(caps, engine, { schemaVersion } = {}) {
  if (!caps.advancedEngines.includes(engine)) {
    throw new HarnessError(`this deployment has no "${engine}" authoring engine`, {
      code: "capability_unavailable",
      hint: `advanced engines: ${caps.advancedEngines.join(", ") || "none"}`,
    })
  }
  if (typeof schemaVersion === "number" && !caps.advancedSchemaVersions.includes(schemaVersion)) {
    throw new HarnessError(`this deployment's "${engine}" engine does not author schema version ${schemaVersion}`, {
      code: "capability_unavailable",
      hint: `advanced scene schema versions: ${caps.advancedSchemaVersions.join(", ") || "none"}`,
    })
  }
}

/** A run id every prompt, label and idempotency key in the run is stamped with. */
export function newRunId() {
  return crypto.randomUUID()
}

/**
 * Idempotency keys are derived from the run id AND a per-call label.
 *
 * Two concurrent benchmark runs with byte-identical bodies would otherwise
 * collapse into one job under a shared key, and the harness would report a
 * concurrency number it never actually produced.
 */
export function idempotencyKeyFor(runId, label) {
  return `s3d-acc-${runId}-${label}`.slice(0, 255)
}

/** Attach the run id to a brief so a job is traceable back to its receipt. */
export function stampPrompt(prompt, runId) {
  return `${prompt.trim()}\n\n[acceptance-run ${runId}]`
}

/**
 * Submit ONE paid job, and never a second one.
 *
 * A submit that throws is left thrown, with the idempotency key surfaced in the
 * message: a POST that timed out may or may not have created a job, and the
 * platform's own rule ("do not blindly retry an ambiguous paid request") means
 * the operator resolves it by attaching to the job — `lifecycle --observe` —
 * not by the harness sending the body again under a fresh key.
 */
export async function submitOnce(client, { type, params, idempotencyKey }) {
  try {
    const result = await client.nodes.run(type, params, { idempotencyKey })
    const jobId = typeof result?.jobId === "string" ? result.jobId : null
    if (!jobId) {
      throw new HarnessError(`${type} returned no jobId`, {
        code: "no_job_id",
        hint: `response keys: ${Object.keys(result ?? {}).join(", ") || "none"}`,
      })
    }
    return { jobId, result }
  } catch (error) {
    if (error instanceof HarnessError) throw error
    throw new HarnessError(`${type} submit failed: ${error?.message ?? error}`, {
      code: "submit_failed",
      hint: `NOT resubmitted. If the request reached the server a job may exist under Idempotency-Key ${idempotencyKey}; find it with \`list_jobs\` / the library and attach with \`lifecycle --observe <jobId>\`.`,
    })
  }
}

/** The user's credit balance, or `null` when this deployment has no credits. */
export async function readBalance(client) {
  try {
    const balance = await client.credits.balance()
    return typeof balance?.total === "number" ? balance.total : null
  } catch {
    return null
  }
}

/**
 * Download bytes to a file, with no credential attached.
 *
 * Result media lives on a CDN URL the job handed back; sending the API key to
 * it would be a credential leak to a host that never asked for one.
 */
export async function downloadTo(url, path) {
  const { writeFile } = await import("node:fs/promises")
  const response = await fetch(url, { redirect: "follow" })
  if (!response.ok) throw new HarnessError(`download failed (${response.status}) for ${new URL(url).host}`, { code: "download_failed" })
  const bytes = Buffer.from(await response.arrayBuffer())
  await writeFile(path, bytes)
  return { path, byteLength: bytes.byteLength }
}
