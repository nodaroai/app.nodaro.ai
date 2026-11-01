// @test-watches backend/src/**/*.ts
/**
 * Every new AI job records the model it runs: `input_data.resolvedModel`.
 *
 * The admin Jobs page filters by model on
 * `coalesce(resolvedModel, provider, llmModel, model)` of a row's input_data
 * (migration 575). Before this key existed, a job whose model the server
 * defaulted stored no model at all, and a job whose `provider` held a vendor
 * or UI name ("claude", "kling", "topaz") stored the wrong one — the filter
 * missed both, silently.
 *
 * The rule is mechanical: a file that creates a job AND takes a model-shaped
 * field (`provider` / `llmModel` / `model` / `analysisModel` in a schema, or
 * any `llmModel` / `analysisModel`) must write `resolvedModel`, or be listed in
 * NO_MODEL with the reason its field is not a model. A route whose stamp is
 * written by a helper in another file names that file in STAMPED_IN.
 *
 * What it cannot see: a route whose request schema lives in another module and
 * that names no model field itself. The two that exist today are listed in
 * STAMPED_IN; a new one is caught only by review.
 */
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join, dirname, relative } from "node:path"
import { fileURLToPath } from "node:url"

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..")

function tsFiles(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "__tests__") continue
    const full = join(dir, e.name)
    if (e.isDirectory()) out.push(...tsFiles(full))
    else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts")) out.push(full)
  }
  return out
}

/** A job insert through the insert-job.ts helpers (the only way a job is created; no-direct-job-insert.test.ts). */
const INSERTS_JOB = /\binsert(?:Sync|Internal)?Jobs?(?:Idempotent)?\s*(?:<[^>]*>)?\s*\(/
/** A model-shaped request field: a schema key of a zod type, or the LLM model fields wherever they appear. */
const MODEL_FIELD = /^\s*(?:provider|llmModel|model|analysisModel)\s*:\s*(?:z\.|[A-Za-z_][\w.]*(?:Enum|Schema)\b)|\b(?:llmModel|analysisModel)\b/m
/** The key written inline, or through the queued-job helper (lib/job-resolved-model.ts). */
const STAMPS = /\bresolvedModel\b|\bwithResolvedModel\(/

/** The insert helpers themselves and the plugin contract's own lane (its rows are the plugin's). */
const NOT_A_JOB_CREATOR = new Set(["lib/insert-job.ts", "lib/private-plugins/toolkit.ts"])

/** Files whose field is not the model the job runs — each with why. */
const NO_MODEL: Readonly<Record<string, string>> = {
  "routes/ai-avatar.ts":
    "`model` is the voice engine's TTS model inside a HeyGen avatar request (eleven_v3, s1…), not the avatar model; HeyGen avatars have no catalog id",
  "routes/generate-music.ts":
    "its only model, MiniMax Music, has no catalog id, and its `provider` value \"minimax\" IS the catalog id of the Hailuo VIDEO model (see MUSIC_CREDIT_ID) — stamping it would file music jobs under Hailuo; awaiting a decision on a music catalog id",
}

/** Files whose stamp is written in another file, named here. */
const STAMPED_IN: Readonly<Record<string, string>> = {
  "routes/generate-image.ts": "routes/generate-image-plan.ts",
  "routes/llm-structured.ts": "lib/llm-structured-request.ts",
  "routes/llm-structured-jobs.ts": "lib/llm-structured-request.ts",
}

const rel = (f: string) => relative(SRC_DIR, f).split("\\").join("/")
const src = (r: string) => readFileSync(join(SRC_DIR, r), "utf8")

describe("every AI job records the model it runs (input_data.resolvedModel)", () => {
  const files = tsFiles(SRC_DIR).map(rel)
  const candidates = files.filter((r) => !NOT_A_JOB_CREATOR.has(r)).filter((r) => {
    const s = src(r)
    return INSERTS_JOB.test(s) && (MODEL_FIELD.test(s) || Object.hasOwn(STAMPED_IN, r))
  })

  it("finds job creators with a model field (the guard is wired to something)", () => {
    expect(candidates.length).toBeGreaterThan(50)
  })

  it("each one writes resolvedModel, or says why its field is not a model", () => {
    const missing = candidates.filter((r) => {
      if (Object.hasOwn(NO_MODEL, r)) return false
      const where = Object.hasOwn(STAMPED_IN, r) ? STAMPED_IN[r]! : r
      return !STAMPS.test(src(where))
    })
    expect(
      missing,
      `These files create a job and take a model field, but never record the model the job runs:\n` +
        missing.map((m) => `  - src/${m}`).join("\n") +
        `\n\nWrite \`resolvedModel\` into the row's input_data: the variable the route already runs and bills ` +
        `with (an LLM route's \`llmModel\`), or \`withResolvedModel(inputData, "<job name>")\` from ` +
        `lib/job-resolved-model.js for a queued job (its handler's default included). If the field is not ` +
        `the model the job runs, list the file in NO_MODEL with the reason.`,
    ).toEqual([])
  })

  it("the allowlists name real files that still need them", () => {
    const stale = [
      ...Object.keys(NO_MODEL).filter((r) => !candidates.includes(r) || STAMPS.test(src(r))),
      ...Object.keys(STAMPED_IN).filter((r) => !files.includes(r) || !STAMPS.test(src(STAMPED_IN[r]!))),
    ]
    expect(stale, `Stale allowlist entries (file gone, no longer a candidate, or now stamping itself): ${stale.join(", ")}`).toEqual([])
  })
})
