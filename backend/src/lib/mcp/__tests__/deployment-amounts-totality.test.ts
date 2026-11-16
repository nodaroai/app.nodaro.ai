// @test-watches backend/src/lib/mcp/**/*.ts backend/src/lib/concurrency-lanes/queue-copy.ts
/**
 * TOTALITY: every amount the MCP lane states goes through ONE funnel,
 * `lib/mcp/amounts.ts` (decided 2026-11-15) — on a deployment with its own
 * unit, a figure that skips it reaches the model in the platform's raw credits.
 *
 * The scan is held both ways, per FILE and per COUNT (a guard keyed by file
 * alone misses a new figure added inside a file already on its list):
 *
 *  1. A figure interpolated into a sentence before the word "credits" / "cr"
 *     (`${n} credits`) is raw by construction — the funnel's sentences say
 *     `${statedAmount(n)} ${amountWord()}`. Every one left must be in
 *     `RAW_SENTENCES` with its count and the reason it is deliberately raw.
 *  2. Every file that names an amount — calls a producer of credit figures
 *     (`statedPrices(`, `loadChargedPrices(`, `runCreditsFor(`, …) or names an
 *     amount field (`creditsCharged`, `totalCredits`, `.credits`, …) — is in
 *     `AMOUNT_FILES` with exactly the count found, and either imports the
 *     funnel or carries the reason its figures are not stated (or are stated
 *     elsewhere). A new figure in any file moves its count and fails here,
 *     until someone has looked at it: through the funnel, bump the count; raw on
 *     purpose, say why.
 *
 * Two more, held the same way:
 *
 *  3. Every file that serves a DOCUMENT (a skill, a recipe, a director's
 *     doctrine, a guide a plugin answers) states it through
 *     `served-documents.ts`, so its figures follow the deployment's unit too.
 *  4. Every sentence that advises a purchase (top up, upgrade, buy, add
 *     credits) is in `PURCHASE_FILES` with its count and the switch that keeps
 *     it off a deployment without self-serve billing.
 *
 * Comment lines (`//`, ` *`) are not scanned: they state nothing to a client.
 */
import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import { join, relative, resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const MCP_DIR = resolve(here, "..")
const FUNNEL = "amounts.ts"

/** Calls that yield credit figures, and the fields that carry them. */
const AMOUNT_TOKEN = new RegExp(
  [
    // producers
    String.raw`\bstatedPrices\(`, String.raw`\bloadChargedPrices\(`, String.raw`\brunCreditsFor\(`, String.raw`\bpublicCreditFieldsOf\(`,
    String.raw`\bCreditsService\.`, String.raw`\blistUsageTransactions\(`, String.raw`\bcreditsOf\(`, String.raw`\bgetChargedPriceTable\(`,
    String.raw`\breadDeploymentBalance\(`, String.raw`\bbuildUgcQuote\(`, String.raw`\banswerPriceIds\(`,
    // amount fields
    String.raw`\b(?:creditsCharged|creditsHeld|creditsReleased|creditsActual|credits_charged|credits_held|credits_released|credits_used|credits_reserved|credits_granted|credits_actual)\b`,
    String.raw`\b(?:totalCredits|stepsCredits|feeCredits|_feeCredits|analysisCredits|estimatedCredits|holdCredits|expectedCredits|privacyCredits|quotedCredits|appCreditsAllowance)\b`,
    String.raw`\b(?:spent_credits|reserved_credits|upfront_credit_estimate|estimated_credits|per_minute_credits|per_item_credits|max_estimated_credits|max_per_minute_credits|max_per_item_credits)\b`,
    String.raw`\.credits\b`, String.raw`\bcredits\??\s*:`,
    // a column list that reads `jobs.credits` (a select string)
    String.raw`,\s*credits\s*(?=,|["'\x60])`,
  ].join("|"),
  "g",
)

/** A figure interpolated before the word credits / cr: a sentence that states raw credits. */
const RAW_SENTENCE = /\$\{[^}]*\}\s*(?:credits?|cr)\b/g

/**
 * Raw on purpose, by file: how many such sentences and why. Empty is the goal;
 * an entry needs a reason a reviewer can check.
 */
const RAW_SENTENCES: Readonly<Record<string, { count: number; why: string }>> = {}

/**
 * Every file of the lane that names an amount: how many times, and how its
 * figures reach a client. `funnel: true` — it imports `amounts.ts` and states
 * its figures through it. Otherwise `why` says why a figure here is not stated
 * raw (it is converted where it is stated, or it never reaches a client).
 */
const PROSE = "the only match is description prose that names credits without stating a figure"
const AMOUNT_FILES: Readonly<Record<string, { count: number } & ({ funnel: true } | { funnel?: false; why: string })>> = {
  // ── stated through the funnel ──
  "tools/_credit-hint.ts": { count: 15, funnel: true }, // every description price hint (statedPrices → stated())
  "tools/models.ts": { count: 21, funnel: true }, // check_balance, credit_transactions, list_models
  "tools/jobs.ts": { count: 13, funnel: true }, // get_job, wait_for_job, list_jobs (withCreditsCharged → statedJobRow)
  "tools/gallery.ts": { count: 1, funnel: true }, // get_asset (statedJobRow)
  "tools/apps.ts": { count: 11, funnel: true }, // list_apps, retry_app_run, run_app's refusal
  "tools/components.ts": { count: 1, funnel: true }, // list_components
  "tools/render-final.ts": { count: 12, funnel: true }, // render_final's quote
  "tools/cast-swap.ts": { count: 17, funnel: true }, // cast_swap's quote
  "tools/cast-swap-full-quality.ts": { count: 8, funnel: true }, // estimate_full_quality, full_quality
  "tools/trends.ts": { count: 22, funnel: true }, // estimate_trend, run_trend
  "tools/recast.ts": { count: 4, funnel: true }, // start_recast's quote
  "tools/ugc.ts": { count: 1, funnel: true }, // build_ugc_clips' quote
  "tools/diagnose.ts": { count: 10, funnel: true }, // diagnose_run's creditsActual
  "tools/pipelines.ts": { count: 6, funnel: true }, // get_pipeline_status' counters
  "tools/verbs-use-case-estimate.ts": { count: 24, funnel: true }, // estimate_use_case
  "served-documents.ts": { count: 1, funnel: true }, // every served document's figures (the match is its credits-word pattern)
  // ── not stated raw, for the reason given ──
  "tools/_job-view.ts": {
    count: 18,
    why: "declares the job envelope's credit fields and copies them from the row it is given; its only callers (jobs.ts) hand it a row statedJobRow already converted",
  },
  "flows/conversation-list.ts": {
    count: 4,
    why: "the conversation list's credit figure feeds the REST route routes/mcp-conversations.ts, never an MCP tool reply",
  },
  "tools/characters.ts": { count: 1, why: PROSE },
  "tools/creatures.ts": { count: 1, why: PROSE },
  "tools/locations.ts": { count: 1, why: PROSE },
  "tools/objects.ts": { count: 1, why: PROSE },
  "tools/dubbing.ts": { count: 1, why: PROSE },
}

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "__tests__" || entry.name === "node_modules") continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...sourceFiles(path))
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) out.push(path)
  }
  return out
}

/** The file's code lines: comment-only lines dropped. */
function codeOf(path: string): string {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => !/^\s*(?:\/\/|\*|\/\*)/.test(line))
    .join("\n")
}

function scan(): { amounts: Record<string, number>; sentences: Record<string, number>; funnelled: Set<string> } {
  const amounts: Record<string, number> = {}
  const sentences: Record<string, number> = {}
  const funnelled = new Set<string>()
  for (const path of sourceFiles(MCP_DIR)) {
    const file = relative(MCP_DIR, path)
    if (file === FUNNEL) continue
    const code = codeOf(path)
    const a = code.match(AMOUNT_TOKEN)?.length ?? 0
    const s = code.match(RAW_SENTENCE)?.length ?? 0
    if (a > 0) amounts[file] = a
    if (s > 0) sentences[file] = s
    if (/from\s+["'](?:\.\.?\/)+amounts\.js["']/.test(code)) funnelled.add(file)
  }
  return { amounts, sentences, funnelled }
}

/** A file that serves a document: it reads one off disk, or relays the markdown a route answers. */
const SERVES_DOCUMENT = /@reads\s[^\n]*skills\/|markdownResult\(|\.markdown\b/
const DOCUMENTS = "served-documents.ts"

/**
 * Every file that serves a document, with how many it serves through the
 * funnel (`statedDocument(` calls) — or why it serves none itself.
 */
const DOCUMENT_FILES: Readonly<Record<string, { stated: number } | { stated?: undefined; why: string }>> = {
  "tools/skill-loaders.ts": { stated: 2 }, // start_workflow_editor, get_node_skill
  "tools/recipes.ts": { stated: 3 }, // get_recipe: the listing, a recipe, a recipe's file
  "tools/video-director.ts": { stated: 1 }, // start_video_director
  "tools/film-director.ts": { stated: 1 }, // start_film_director
  "tools/recast.ts": { stated: 1 }, // get_recast_authoring_skill (a plugin's route answers it)
  "tools/studio-production.ts": { stated: 3 }, // get_studio_production_skill: operating, authoring, catalog (the schema is types, not prose)
  "tools/_studio-helpers.ts": { why: "defines markdownResult; the guides it wraps are stated by studio-production.ts before they reach it" },
}

/** Advice to buy: top up, upgrade, buy, purchase, add credits. Field names (`topup`, `upgradeHint`) are not words of it. */
const PURCHASE_WORD = /\btop[ -]ups?\b|\btopped up\b|\bupgrade[ds]?\b|\bbuy\b|\bbought\b|\bpurchase[ds]?\b|\badd(?:ed)? (?:more )?(?:credits|\$\{amountWord\(\)\})/gi
/** Outside lib/mcp, the job tools' queue sentences. */
const QUEUE_COPY = resolve(MCP_DIR, "../concurrency-lanes/queue-copy.ts")

/**
 * Every file whose sentences name a purchase, with how many and what keeps
 * them off a deployment without self-serve billing (`billing.selfServe:
 * false`) or whose balance it manages (`balanceManagedByDeployment()`).
 */
const PURCHASE_FILES: Readonly<Record<string, { count: number; why: string }>> = {
  "amounts.ts": { count: 4, why: "the self-serve branch of balanceNextStep, and the managed note that says nothing can be topped up, bought or upgraded" },
  "tools/_job-error.ts": { count: 1, why: "failureGuidance's credits branch: only where balanceManagedByDeployment() is false" },
  "tools/apps.ts": { count: 3, why: "retry_app_run's next step: each only where balanceManagedByDeployment() is false" },
  "tools/render-final.ts": { count: 1, why: "render_final's next step: only where balanceManagedByDeployment() is false" },
  "tools/models.ts": {
    count: 8,
    why: "check_balance's managed note (a negation) and its self-serve description (chosen by ownTermsActive()); credit_transactions describes the purchase history it lists",
  },
  "tools/recast.ts": { count: 1, why: "start_recast reports the planning step it charged (\"Plan purchased\"): a record, not advice" },
  "../concurrency-lanes/queue-copy.ts": { count: 2, why: "the queue's upgrade hint, which queue-info.ts sets to null without self-serve billing" },
}

describe("every amount the MCP lane states goes through lib/mcp/amounts.ts", () => {
  const found = scan()

  it("no sentence states a raw credit figure, except the reasoned ones (held both ways)", () => {
    if (process.env.PRINT_AMOUNT_SCAN === "1") console.log(JSON.stringify(found.sentences, null, 2))
    expect(found.sentences).toEqual(Object.fromEntries(Object.entries(RAW_SENTENCES).map(([f, e]) => [f, e.count])))
  })

  it("every file that names an amount is listed with its exact count (held both ways)", () => {
    if (process.env.PRINT_AMOUNT_SCAN === "1") console.log(JSON.stringify(found.amounts, null, 2))
    expect(found.amounts).toEqual(Object.fromEntries(Object.entries(AMOUNT_FILES).map(([f, e]) => [f, e.count])))
  })

  it("a file listed as stating its figures through the funnel imports it, and one that does not says why", () => {
    for (const [file, entry] of Object.entries(AMOUNT_FILES)) {
      if (entry.funnel) expect(found.funnelled.has(file), `${file} is listed as funnelled but does not import amounts.js`).toBe(true)
      else expect(entry.why.length, `${file} needs a reason`).toBeGreaterThan(20)
    }
  })
})

describe("every document the lane serves goes through lib/mcp/served-documents.ts", () => {
  it("every file that serves one is listed, imports the funnel and calls it as often as listed (held both ways)", () => {
    const found: Record<string, number | "none"> = {}
    for (const path of sourceFiles(MCP_DIR)) {
      const file = relative(MCP_DIR, path)
      if (file === DOCUMENTS) continue
      const raw = readFileSync(path, "utf8")
      if (!SERVES_DOCUMENT.test(raw)) continue
      const calls = codeOf(path).match(/\bstatedDocument\(/g)?.length ?? 0
      found[file] = calls > 0 ? calls : "none"
      if (calls > 0) expect(/from\s+["'](?:\.\.?\/)+served-documents\.js["']/.test(raw), `${file} imports served-documents.js`).toBe(true)
    }
    expect(found).toEqual(Object.fromEntries(Object.entries(DOCUMENT_FILES).map(([f, e]) => [f, e.stated ?? "none"])))
    for (const [file, e] of Object.entries(DOCUMENT_FILES)) if (e.stated === undefined) expect(e.why.length, `${file} needs a reason`).toBeGreaterThan(20)
  })
})

describe("no purchase advice reaches a deployment without self-serve billing", () => {
  it("every sentence that names a purchase is listed with its count and what keeps it off such a deployment (held both ways)", () => {
    const found: Record<string, number> = {}
    for (const path of [...sourceFiles(MCP_DIR), QUEUE_COPY]) {
      const n = codeOf(path).match(PURCHASE_WORD)?.length ?? 0
      if (n > 0) found[relative(MCP_DIR, path)] = n
    }
    if (process.env.PRINT_AMOUNT_SCAN === "1") console.log(JSON.stringify(found, null, 2))
    expect(found).toEqual(Object.fromEntries(Object.entries(PURCHASE_FILES).map(([f, e]) => [f, e.count])))
  })
})
