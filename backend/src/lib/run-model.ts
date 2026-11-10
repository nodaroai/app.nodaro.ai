/**
 * Builders for `CreditGuardOpts.runModel` — the model a request RUNS on, read
 * off its RAW body (the guard runs before validation), in the vocabulary the
 * deployment's model restriction is written in (`MODEL_CATALOG` / `LLM_MODELS`
 * ids). Each one reads the same field the route reads and falls back to the
 * same default the route fills in after the guard, from the same constant —
 * never a copy of it. None of them throws on a malformed body: a value of the
 * wrong type reads as absent, as the route's own default would treat it.
 *
 * Which builder a route takes, and why, is pinned for every credit-guarded
 * route in src/__tests__/credit-guard-run-model-census.test.ts.
 */
import type { FastifyRequest } from "fastify"
import { llmFeatureDefaultModel } from "@nodaro/render-rules"
import { applyDefaultVideoSelection } from "@nodaro/shared/models"
import { judgedModelOfJob, RESOLVED_MODEL_OF_JOB, resolvedModelOfJob } from "./job-resolved-model.js"

/** What `CreditGuardOpts.runModel` takes. */
export type RunModelResolver = (req: FastifyRequest) => string | readonly string[] | undefined

/** The raw (unvalidated) body as a record; empty for none or a non-object. */
export function rawBodyRecord(req: Pick<FastifyRequest, "body">): Record<string, unknown> {
  const body = req.body
  return body !== null && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {}
}

/** A non-empty string, else undefined — how a route's `x ?? DEFAULT` reads a field. */
export function textField(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

/** A route that runs one model whatever the request says (no model field). */
export function fixedRunModel(model: string): RunModelResolver {
  return () => model
}

/** The body's `provider`, else the route's `fallback` (its schema default or its `?? DEFAULT`). */
export function providerRunModel(fallback: string): RunModelResolver {
  return (req) => textField(rawBodyRecord(req).provider) ?? fallback
}

/**
 * The model a job named `jobName` runs on, with the request body as its
 * payload: `RESOLVED_MODEL_OF_JOB`, which decides as the job's handler decides
 * — its default, and the catalog's spelling of a provider option (`kling` →
 * `motion-transfer`, `topaz` → `topaz-video`, Suno's `V6` → `suno-v6`). For a
 * route whose request fields ARE the job's and whose default is the handler's.
 * Throws at registration for a job the registry does not know.
 */
export function jobRunModel(jobName: string): RunModelResolver {
  if (!Object.hasOwn(RESOLVED_MODEL_OF_JOB, jobName)) throw new Error(`jobRunModel: no resolved-model entry for job "${jobName}"`)
  return (req) => resolvedModelOfJob(jobName, rawBodyRecord(req))
}

/**
 * A video generation route (`/v1/text-to-video`, `/v1/generate-video`): the
 * body's `provider`, else the platform's default video model —
 * `applyDefaultVideoSelection`, the one rule both routes and the workflow
 * builder apply.
 */
export const videoRunModel: RunModelResolver = (req) =>
  applyDefaultVideoSelection({ provider: textField(rawBodyRecord(req).provider) }).provider

/** The default model of an LLM feature (through `llmDefaultsFeature`); undefined for an unknown one. The
 *  editor's menus and the new-node rule read the same function (`@nodaro/render-rules`). */
export const llmFeatureDefault: (feature: string) => string | undefined = llmFeatureDefaultModel

/**
 * A scrape that analyses what it finds (Meta Ads Library, Instagram): with
 * `analyze: true` each item's analysis runs the body's `analysisModel`, else
 * the `meta-ads-analysis` default — the rule both routes apply. Without
 * analysis the scrape runs no model.
 */
export const adAnalysisRunModel: RunModelResolver = (req) => {
  const body = rawBodyRecord(req)
  return body.analyze === true ? (textField(body.analysisModel) ?? llmFeatureDefault("meta-ads-analysis")) : undefined
}

/**
 * An LLM route: the body's `llmModel`, else its feature's default model — the
 * `parsed.data.llmModel ?? LLM_FEATURE_DEFAULTS[feature]` every such route
 * runs. `feature` may read the body (Motion Graphics picks its feature by
 * engine). Throws at registration for a fixed feature with no default.
 */
export function llmRunModel(feature: string | ((body: Record<string, unknown>) => string)): RunModelResolver {
  if (typeof feature === "string" && llmFeatureDefault(feature) === undefined) {
    throw new Error(`llmRunModel: the LLM feature "${feature}" has no default model`)
  }
  return (req) => {
    const body = rawBodyRecord(req)
    return textField(body.llmModel) ?? llmFeatureDefault(typeof feature === "string" ? feature : feature(body))
  }
}

// ── The workflow lane: the model a BUILT job runs ─────────────────────────────

/**
 * Jobs that run one fixed model and reserve under that model's id, so the id
 * the build reserves under IS the model that runs — what the workflow lane
 * judges for them, since no payload field names it. Dubbing's id follows its
 * target language (`dubbingModelIdentifier`). The census
 * (services/workflow-engine/__tests__/default-model-judge-census.test.ts)
 * holds each one's id to a model a restriction can name.
 */
export const FIXED_MODEL_JOBS: ReadonlySet<string> = new Set([
  "audio-isolation",
  "dubbing",
  "forced-alignment",
  "voice-changer",
  "voice-design",
])

/** Whether the workflow lane can tell the model a job named `jobName` runs on. */
export function judgesJobRunModel(jobName: string): boolean {
  return Object.hasOwn(RESOLVED_MODEL_OF_JOB, jobName) || FIXED_MODEL_JOBS.has(jobName)
}

/**
 * The model a job built for a workflow node RUNS on, as a model restriction
 * judges it — the workflow lane's counterpart of `CreditGuardOpts.runModel`,
 * read off the BUILT job: its payload, with every default the build filled in,
 * and the id it reserves under. A job the resolved-model registry knows answers
 * through `judgedModelOfJob` (as its handler decides, before generate-image's
 * image-to-image swap); a fixed-model job answers its reserved id; any other
 * job answers undefined.
 */
export function jobRunModelOfBuild(
  jobName: string,
  payload: Readonly<Record<string, unknown>>,
  modelIdentifier: string,
): string | undefined {
  if (Object.hasOwn(RESOLVED_MODEL_OF_JOB, jobName)) return judgedModelOfJob(jobName, payload)
  return FIXED_MODEL_JOBS.has(jobName) ? textField(modelIdentifier) : undefined
}
