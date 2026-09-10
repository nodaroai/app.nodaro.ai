/**
 * `pro-3d-render` request construction, quoting and result reading.
 *
 * Shared by four of the six probes so they cannot disagree about what a Pro
 * run IS. Two things here are contract, not convenience:
 *
 * ONE — quote and run carry the SAME body. Admission re-checks
 * `normalizedInputHash`, so a field added between the two is not a small
 * inconsistency, it is a refused run. `quoteAndRun` therefore builds the body
 * once and spreads only `quoteId` onto it.
 *
 * TWO — a render-only source is built by ITSELF, never by editing an authoring
 * body. `{kind:'scene'}` with no `editPrompt` is the free export, and the
 * absence of that key is the whole meaning; a timing field copied across from
 * the authoring request is an explicit re-time request the engine is entitled
 * to reject.
 */
import { createHash } from "node:crypto"
import { HarnessError } from "./client.mjs"
import { shortHash } from "./parity.mjs"

/**
 * Quote lines that mean AUTHORING happened — planning, building, repairing.
 *
 * The CODE is machine vocabulary and is matched broadly. The LABEL is display
 * copy a human wrote, and matching it as broadly would fail a perfectly legal
 * render-only quote whose line happens to read "scene plan export" — so the
 * label pattern only matches words that can only mean authoring work.
 */
export const AUTHORING_CODE_PATTERN = /author|plan|astra|build|repair|critic/i
export const AUTHORING_LABEL_PATTERN = /authoring|re-?author|planning|repair pass|scene build/i
/** @deprecated kept as the code vocabulary's name for readers of older receipts. */
export const AUTHORING_LINE_PATTERN = AUTHORING_CODE_PATTERN

/** Build a Pro body with no `undefined` keys — an explicit `undefined` and an
 *  absent key are the same on the wire only by luck of the serializer. */
export function buildProParams(fields) {
  const out = {}
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue
    if (Array.isArray(value) && value.length === 0) continue
    out[key] = value
  }
  return out
}

/** An authoring request: a brief, its references, and the timing it asks for. */
export function promptSourceParams({ prompt, references = [], engine, durationSeconds, fps, aspectRatio, maxRepairPasses, forcePrivate }) {
  return buildProParams({
    source: buildProParams({ kind: "prompt", prompt, references }),
    engine,
    durationSeconds,
    fps,
    aspectRatio,
    maxRepairPasses,
    acceptedSceneSchemaVersions: [2],
    forcePrivate: forcePrivate === true ? true : undefined,
  })
}

/**
 * A render-only request: export this revision, spend no authoring.
 *
 * No `editPrompt`, and no timing overrides — both by omission, deliberately.
 */
export function renderOnlyParams({ revisionId, sourceJobId, engine }) {
  if (!revisionId) throw new HarnessError("render-only needs a revisionId", { code: "bad_source" })
  return buildProParams({
    source: buildProParams({ kind: "scene", revisionId, sourceJobId }),
    engine,
    acceptedSceneSchemaVersions: [2],
  })
}

/** The quote, reduced to what a receipt should carry (all of it, in fact). */
export function summarizeQuote(quote) {
  return {
    quoteId: quote?.quoteId ?? null,
    expiresAt: quote?.expiresAt ?? null,
    maxCredits: typeof quote?.maxCredits === "number" ? quote.maxCredits : null,
    breakdown: Array.isArray(quote?.breakdown) ? quote.breakdown.map((line) => ({ code: line.code, label: line.label, credits: line.credits })) : [],
    pricingVersion: quote?.pricingVersion ?? null,
    capabilitiesVersion: quote?.capabilitiesVersion ?? null,
    normalizedInputHash: quote?.normalizedInputHash ?? null,
  }
}

/** Quote lines whose code or label reads as authoring work. */
export function authoringLines(breakdown) {
  return (breakdown ?? []).filter(
    (line) => AUTHORING_CODE_PATTERN.test(String(line.code ?? "")) || AUTHORING_LABEL_PATTERN.test(String(line.label ?? "")),
  )
}

/**
 * Price the body, then submit exactly that body once.
 *
 * A quote is a price, not a purchase — but it EXPIRES, so the run follows it
 * immediately. Nothing between the two calls may touch `params`.
 */
export async function quoteAndRun(client, { params, idempotencyKey, onQuote }) {
  const quote = await client.scene3d.quotePro(params)
  if (!quote?.quoteId) throw new HarnessError("quote returned no quoteId", { code: "bad_quote" })
  if (onQuote) await onQuote(quote)
  let result
  try {
    result = await client.scene3d.runPro({ ...params, quoteId: quote.quoteId }, { idempotencyKey })
  } catch (error) {
    throw new HarnessError(`pro-3d-render submit failed: ${error?.message ?? error}`, {
      code: "submit_failed",
      hint: `NOT resubmitted. A job may exist under Idempotency-Key ${idempotencyKey}; attach with \`lifecycle --observe <jobId>\`.`,
    })
  }
  const jobId = typeof result?.jobId === "string" ? result.jobId : null
  if (!jobId) throw new HarnessError("pro-3d-render returned no jobId", { code: "no_job_id" })
  return { quote, jobId, result }
}

/** A committable summary of a scene plan: identity and size, not the plan. */
export function summarizePlan(plan) {
  if (!plan || typeof plan !== "object") return null
  const json = JSON.stringify(plan)
  return {
    planType: plan.planType ?? null,
    schemaVersion: typeof plan.schemaVersion === "number" ? plan.schemaVersion : null,
    revisionId: plan.revisionId ?? null,
    parentRevisionId: plan.parentRevisionId ?? null,
    width: plan.width ?? null,
    height: plan.height ?? null,
    fps: plan.fps ?? null,
    durationInFrames: plan.durationInFrames ?? null,
    objectCount: Array.isArray(plan.objects) ? plan.objects.length : null,
    assetCount: Array.isArray(plan.assets) ? plan.assets.length : null,
    shotCount: Array.isArray(plan.shots) ? plan.shots.length : null,
    overrideCount: Array.isArray(plan.overrides) ? plan.overrides.length : null,
    referenceCount: Array.isArray(plan.references) ? plan.references.length : null,
    contentHash: plan?.provenance?.contentHash ?? null,
    provenance: plan?.provenance ?? null,
    planSha256: createHash("sha256").update(json).digest("hex"),
    planBytes: json.length,
  }
}

/** The settled Pro result, reduced for a receipt. */
export function summarizeProOutput(output) {
  if (!output || typeof output !== "object") return null
  return {
    videoUrl: typeof output.videoUrl === "string" ? output.videoUrl : null,
    sceneRevisionId: output.sceneRevisionId ?? null,
    posterAssetId: output.posterAssetId ?? null,
    sourceArtifactId: output.sourceArtifactId ?? null,
    renderer: output.renderer ?? null,
    metadata: output.metadata ?? null,
    validation: output.validation
      ? {
          status: output.validation.status ?? null,
          reportAssetId: output.validation.reportAssetId ?? null,
          warningCount: Array.isArray(output.validation.warnings) ? output.validation.warnings.length : null,
          warnings: Array.isArray(output.validation.warnings) ? output.validation.warnings : [],
        }
      : null,
    changeSummary: typeof output.changeSummary === "string" ? output.changeSummary : null,
    changeSummarySha: typeof output.changeSummary === "string" ? shortHash(output.changeSummary) : null,
    plan: summarizePlan(output.scenePlan),
    extraKeys: Object.keys(output).filter((k) => !["videoUrl", "scenePlan", "sceneRevisionId", "posterAssetId", "sourceArtifactId", "validation", "renderer", "metadata", "changeSummary"].includes(k)),
  }
}

/**
 * Everything the run can HONESTLY say about repair passes.
 *
 * The published result contract carries no repair counter, so this reports
 * what exists — the budget that was requested, the budget the quote priced,
 * and any repair-shaped key the runtime attached — and says `null` when the
 * answer is not knowable, rather than inferring one from warnings.
 */
export function repairEvidence({ output, quote, requested }) {
  const quoteLines = (quote?.breakdown ?? []).filter((line) => /repair/i.test(`${line.code ?? ""} ${line.label ?? ""}`))
  const reportedKey = ["repairPasses", "repairPassesUsed", "repairs", "passes"].find(
    (key) => output && typeof output === "object" && output[key] !== undefined,
  )
  return {
    requested: typeof requested === "number" ? requested : null,
    quotedRepairLines: quoteLines,
    reportedByOutput: reportedKey ? { key: reportedKey, value: output[reportedKey] } : null,
    ranAPass: reportedKey ? Boolean(output[reportedKey]) : null,
    evidence: reportedKey
      ? "the completed output reports it"
      : "the completed output does not report a repair count; not inferred from warnings",
  }
}
