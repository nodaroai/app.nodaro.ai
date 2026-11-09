// @test-watches backend/src/**/*.ts
/**
 * FUNNEL CENSUS — provider I/O takes its concurrency slot, and no route leaves
 * work running after its request.
 *
 * The lanes are enforced at two runtime funnels — the provider egress
 * (`providers/egress.ts`, a billing call) and the LLM router
 * (`lib/llm/router.ts`) — plus the SDK clients that own their transport (the
 * Replicate and fal clients, whose prediction-creating calls take a slot at
 * the egress). Provider I/O that goes past all of them is not gated at all, so
 * every non-test file that
 *   - constructs a provider SDK client (`new Anthropic(`, `new OpenAI(`,
 *     `new GoogleGenAI(`, `new Replicate(`), or
 *   - imports a `*_BASE_URL` / `*_API_URL` from `providers/` and calls a raw
 *     `fetch(`, or
 *   - is the film pipeline's own LLM caller (`ee/pipelines/llms/call-llm.ts`,
 *     direct `anthropic.messages.*` and `callKie` calls)
 * must take a slot itself — `ensureConcurrencySlot(` / `withConcurrencySlot(`
 * / `runNotLimited(` — or be listed WITH the reason it needs none.
 *
 * DETACHED WORK — a route that answers and then keeps working in the API
 * process (`void run…()`, `void (async () => …)()`, `setImmediate(`,
 * `queueMicrotask(`) keeps its request's scope after the request's slot was
 * released, and does not survive a deploy. Background work is a worker job.
 *
 * A stale entry fails, so a file that changes leaves no permanent hole.
 *
 * What it does NOT see (it is a census of the brief's three populations, not
 * a proof): it is file-level — a file that already takes a slot passes when it
 * adds a second, unwrapped call; a fetch spelled `globalThis.fetch(` or to a
 * provider URL written as a string literal (not an imported `*_BASE_URL`); and
 * provider I/O through a client whose construction lives elsewhere.
 */
import { describe, expect, it } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join, normalize } from "node:path"

const SRC = join(__dirname, "..", "..", "..")

/** The funnels themselves: they take the slot for what passes through them. */
const FUNNELS: ReadonlyMap<string, string> = new Map([
  ["providers/egress.ts", "the provider egress: a billing call (and an SDK call that creates work) takes its slot here"],
  ["lib/llm/router.ts", "the LLM router: llmComplete / llmStream take their llm slot here"],
  ["providers/replicate/client.ts", "its SDK transport is egressSdkFetch with createsWork: every prediction it creates takes its slot at the egress"],
  ["providers/fal/client.ts", "its SDK transport is egressSdkFetch with createsWork: every run it submits takes its slot at the egress"],
])

/** Provider I/O that needs no slot of its own, and why. */
const LANE_EXEMPT_PROVIDER_IO: ReadonlyMap<string, string> = new Map([
  ["lib/anthropic.ts", "the shared direct Anthropic client: its callers take the slot — the LLM router's direct lane (inside llmComplete / llmStream / the structured calls), the Copilot (not limited) and the film pipeline's callLLM"],
  ["lib/gemini/client.ts", "the direct Google client: only the LLM router calls it, inside llmComplete / llmStream, which hold the llm slot"],
  ["ee/copilot/kie-client.ts", "the Copilot's own client: the Copilot is not limited (ee/routes/copilot.ts runs its turn in runNotLimited)"],
  ["lib/reconcile/elevenlabs.ts", "the reconcile cron's status reads of jobs already submitted: no new provider work"],
  ["routes/voice-clones.ts", "its only provider call deletes a stored voice: no generation"],
  ["lib/premade-voice-catalog.ts", "its provider call reads the voice catalog (the premade list, for /v1/voices and the voice lock): no generation"],
])

/**
 * Provider I/O whose slot lands in a later task of the same change, listed so
 * it is never a silent pass: each entry is removed by the task that wraps it.
 */
const PENDING_IN_THIS_CHANGE: ReadonlyMap<string, string> = new Map<string, string>([])

const SLOT_CALL = /\b(?:ensureConcurrencySlot|withConcurrencySlot|runNotLimited)\(/
const SDK_CLIENT = /\bnew\s+(?:Anthropic|OpenAI|GoogleGenAI|Replicate)\(/
const RAW_FETCH = /(?<![\w.$])fetch\(/
const NAMED_IMPORT = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g
const PIPELINE_LLM = "ee/pipelines/llms/call-llm.ts"

function tsFiles(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "__tests__" || e.name === "node_modules" || e.name === "test") continue
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...tsFiles(p))
    else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts") && !e.name.endsWith(".test.ts")) out.push(p)
  }
  return out
}

function blankComments(src: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, " ")
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1: string) => p1 + blank(m.slice(p1.length)))
}

const relOf = (abs: string) => abs.slice(SRC.length + 1).split("\\").join("/")

/** Whether `src` (the file at `file`) imports a value named *_BASE_URL / *_API_URL from a module under providers/. */
function importsProviderUrl(file: string, src: string): boolean {
  for (const m of src.matchAll(NAMED_IMPORT)) {
    const spec = m[2]!
    if (!spec.startsWith(".")) continue
    const target = normalize(join(dirname(file), spec)).split("\\").join("/")
    if (!target.startsWith("providers/")) continue
    const names = m[1]!.split(",").map((n) => n.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]!)
    if (names.some((n) => /_(?:BASE_URL|API_URL)$/.test(n))) return true
  }
  return false
}

interface Io { file: string; why: string; takesSlot: boolean }

function providerIo(): Io[] {
  const out: Io[] = []
  for (const abs of tsFiles(SRC)) {
    const file = relOf(abs)
    const src = blankComments(readFileSync(abs, "utf8"))
    const why = SDK_CLIENT.test(src)
      ? "constructs a provider SDK client"
      : importsProviderUrl(file, src) && RAW_FETCH.test(src)
        ? "fetches a provider base URL directly"
        : file === PIPELINE_LLM
          ? "calls anthropic.messages.* / callKie directly"
          : null
    if (why) out.push({ file, why, takesSlot: SLOT_CALL.test(src) })
  }
  return out
}

describe("provider I/O takes its concurrency slot", () => {
  const io = providerIo()

  it("scans the real population", () => {
    expect(io.length).toBeGreaterThanOrEqual(5)
    expect(io.some((h) => h.file === "providers/replicate/client.ts")).toBe(true)
    // A raw provider read past the funnels (the premade voice list); the shared
    // library's listing and walk go through providerFetch and are not counted here.
    expect(io.some((h) => h.file === "lib/premade-voice-catalog.ts")).toBe(true)
  })

  it("the census test lists offenders", () => {
    const offenders = io
      .filter((h) => !h.takesSlot && !FUNNELS.has(h.file) && !LANE_EXEMPT_PROVIDER_IO.has(h.file) && !PENDING_IN_THIS_CHANGE.has(h.file))
      .map((h) => `  • ${h.file} — ${h.why}`)
    expect(
      offenders,
      `These reach a provider past the lane funnels, so their calls are never counted or limited.\n` +
        `Go through providerFetch / the LLM router, or take the slot yourself with withConcurrencySlot( ` +
        `(lib/concurrency-lanes/slot.js) around the call; work that is deliberately not limited runs in ` +
        `runNotLimited(. If the file starts no provider work, add it to LANE_EXEMPT_PROVIDER_IO *with the reason*.\n\n` +
        offenders.join("\n"),
    ).toEqual([])
  })

  it("has no stale entry", () => {
    const listed = [...LANE_EXEMPT_PROVIDER_IO.keys(), ...PENDING_IN_THIS_CHANGE.keys()]
    const stale = listed.filter((f) => !io.some((h) => h.file === f && !h.takesSlot))
    expect(stale, `Listed files that no longer do provider I/O past the funnels (or now take a slot) — delete them:\n${stale.join("\n")}`).toEqual([])
    const goneFunnels = [...FUNNELS.keys()].filter((f) => {
      try {
        readFileSync(join(SRC, f))
        return false
      } catch {
        return true
      }
    })
    expect(goneFunnels).toEqual([])
  })

  // Loose on purpose: the call's name inside the right function, so a reformat
  // never fails it (the behaviour itself is tested in request-scope.test.ts).
  const read = (rel: string) => blankComments(readFileSync(join(SRC, rel), "utf8"))
  /** The text of `name`'s declaration up to the next top-level declaration. */
  const body = (src: string, name: string) => {
    const at = src.search(new RegExp(`function\\s+${name}\\b`))
    if (at < 0) return ""
    const next = src.slice(at + 1).search(/\n(?:export\s+)?(?:async\s+)?function\s/)
    return next < 0 ? src.slice(at) : src.slice(at, at + 1 + next)
  }

  it("anti-vacuity — the funnels really take the slot", () => {
    expect(body(read("providers/egress.ts"), "providerFetch")).toMatch(/withConcurrencySlot\(/)
    expect(body(read("providers/egress.ts"), "egressSdkFetch")).toMatch(/createsWork[\s\S]*withConcurrencySlot\(/)
    expect(body(read("lib/llm/router.ts"), "llmComplete")).toMatch(/withConcurrencySlot\(/)
    expect(body(read("lib/llm/router.ts"), "llmStream")).toMatch(/withConcurrencySlot\(/)
    expect(read("providers/replicate/client.ts")).toMatch(/egressSdkFetch\(\s*"replicate"[\s\S]*?createsWork/)
    expect(read("providers/fal/client.ts")).toMatch(/egressSdkFetch\(\s*"fal"[\s\S]*?createsWork/)
    // The film pipeline's own caller: each attempt in an llm slot (behaviour in call-llm-lanes.test.ts).
    expect(body(read("ee/pipelines/llms/call-llm.ts"), "callLLM")).toMatch(/withConcurrencySlot\(\s*\{\s*lane:\s*"llm"/)
  })

  it("training and the Copilot run not limited", () => {
    expect(read("routes/character-training.ts")).toMatch(/runNotLimited\(\s*"training"[\s\S]{0,80}createCharacterTraining\(/)
    expect(read("ee/routes/copilot.ts")).toMatch(/runNotLimited\(\s*"copilot"/)
  })
})

// ------------------------------------------------------------- detached work

/** Detached work in a route that makes no provider or LLM call in the API process, and why. */
const DETACHED_EXEMPT: ReadonlyMap<string, string> = new Map([
  ["routes/component-execute.ts", "its background part enqueues the component's run as an orchestration job (gated at pickup) and polls its row: no provider or LLM call in this process"],
  ["routes/workflow-execution.ts", "a run's cancel finishes in the background: it cancels and refunds the run's jobs (database writes, queue removals) — it starts no provider or LLM work"],
])

const DETACHED = /\bvoid\s+run[A-Za-z0-9_]*\(|\bvoid\s+\(\s*async\b|\bsetImmediate\(|\bqueueMicrotask\(/

function routeFiles(): string[] {
  const roots = ["routes", "ee/routes", "nodes"].map((r) => join(SRC, r))
  return roots.flatMap((r) => tsFiles(r)).map(relOf)
    .filter((f) => !f.startsWith("nodes/") || /\/route(?:\.ee)?\.ts$/.test(f))
}

describe("no route leaves work running after its request", () => {
  const detached = routeFiles().filter((f) => DETACHED.test(blankComments(readFileSync(join(SRC, f), "utf8"))))

  it("the detached-work census lists offenders", () => {
    const offenders = detached.filter((f) => !DETACHED_EXEMPT.has(f))
    expect(
      offenders,
      `These routes start work that outlives their request (void run…(), void (async …)(), setImmediate(, ` +
        `queueMicrotask(). It keeps the request's lane scope after the request's slot is released and does not ` +
        `survive a deploy. Enqueue a worker job for it instead, and answer { jobId, status: "pending" }.\n\n` +
        offenders.map((f) => `  • ${f}`).join("\n"),
    ).toEqual([])
  })

  it("has no stale entry", () => {
    const listed = [...DETACHED_EXEMPT.keys()]
    const stale = listed.filter((f) => !detached.includes(f))
    expect(stale, `Listed routes that no longer start detached work — delete them:\n${stale.join("\n")}`).toEqual([])
  })
})
