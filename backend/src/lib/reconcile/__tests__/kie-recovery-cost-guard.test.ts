// @test-watches backend/src/lib/reconcile/kie.ts backend/src/nodes/*/recover.ts
/**
 * A job finished by a RECOVERY path records what the provider billed for the
 * run (`jobs.provider_cost`), as a job finished normally does. A KIE recovery
 * reads the bill off the record of the saved task it already polled, through
 * ONE rule: `kieRecoveredCostUsd` (providers/kie/billed-cost.ts) — the record's
 * credits at the same rate `kieBilledCostUsd` applies, else nothing written.
 *
 * Three things are held here, each with a short reasoned list that only
 * shrinks:
 *   1. every KIE kind the reconcile recovers either reads the task record's
 *      credits off its poll, or is listed with why it cannot;
 *   2. every place in lib/reconcile/kie.ts that completes a job is listed by
 *      the function that holds it, with the cost rule it follows — a new one
 *      fails until it states its rule;
 *   3. every node unit's `recover.ts` records its cost through the rule, or is
 *      listed with why.
 */
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, existsSync } from "node:fs"
import { join } from "node:path"
import { KIE_RECOVER_KINDS } from "../types.js"

const KIE_TS = readFileSync(join(__dirname, "..", "kie.ts"), "utf8")
const NODES_DIR = join(__dirname, "..", "..", "..", "nodes")

/** Kinds whose poll gives the recovery no task record to read a bill from. */
const NO_RECORD_KINDS: Readonly<Record<string, string>> = {
  "kie-veo-1080p": "runVeo1080pTask returns only the upgraded clip's URL",
  "kie-kling3": "pollKling3Task returns only the video URL",
  "kie-kontext": "pollKontextTask returns only resultJson",
  "kie-runway": "pollRunwayTask returns only the video URL",
  "kie-aleph": "pollAlephTask returns only the video URL",
  "kie-suno": "Suno music: SunoTaskResult carries tracks, no record (reconcileKieSunoJob)",
  "kie-suno-market": "Suno market lane: pollSunoMarketTracks returns tracks, no record (reconcileKieSunoJob; Speech records its flat charge)",
}

/** Kinds recovered before singlePoll (reconcileKieSunoJob). */
const BEFORE_SINGLE_POLL: ReadonlySet<string> = new Set(["kie-suno", "kie-suno-market"])

/**
 * Every completion call in kie.ts, by the function that holds it: the callee,
 * how many, and the cost rule it follows. `rule: "recovered"` means the
 * function computes the figure with `kieRecoveredCostUsd`.
 */
const COMPLETIONS: Readonly<Record<string, Readonly<Record<string, { count: number; rule: string }>>>> = {
  reconcileKieSunoJob: {
    finalizeJobWithMedia: { count: 1, rule: "Suno Speech: its flat per-request provider charge (SUNO_SPEECH_PROVIDER_COST_USD), as its worker records it; a song: no record in hand (SunoTaskResult)" },
  },
  reconcileKieUnitJob: {
    recover: { count: 1, rule: "the unit's own recover.ts, handed the record's credits as providerCredits (held by the recover.ts check below)" },
  },
  reconcileKieTranscribeJob: {
    markJobCompleted: { count: 1, rule: "Nemotron: nemotronOutputFromResult's cost from the record's credits, the worker's own rule" },
  },
  reconcileKieJob: {
    recoverEntityJob: { count: 1, rule: "recovered" },
    recoverGeminiSpeechJob: { count: 1, rule: "Gemini speech: geminiSpeechCostUsd over the record's credits, the worker's own rule" },
    finalizeJobWithMedia: { count: 1, rule: "recovered" },
  },
}

/** Node units' recover.ts files that do not record through the rule. */
const RECOVER_TS_EXEMPT: Readonly<Record<string, string>> = {}

const OWNER = /^(?:export )?(?:async )?function (\w+)/
const CALL = /\b(finalizeJobWithMedia|markJobCompleted|recoverEntityJob|recoverGeminiSpeechJob|recover)\(/g

function bodies(): Record<string, string> {
  const out: Record<string, string> = {}
  let owner = "(top level)"
  for (const line of KIE_TS.split("\n")) {
    const m = OWNER.exec(line)
    if (m) owner = m[1]!
    out[owner] = (out[owner] ?? "") + line + "\n"
  }
  return out
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
}

describe("KIE recovery paths record the provider's bill through kieRecoveredCostUsd", () => {
  it("every recovered KIE kind reads its task record's credits, or is listed with why it cannot", () => {
    const poll = bodies().singlePoll ?? ""
    const withCredits = new Set<string>()
    const seen = new Set<string>()
    // A case group: its run of `case "…":` labels, then the body up to the next label.
    let labels: string[] = []
    let body = ""
    let inBody = false
    const close = () => {
      if (/kieCredits|readRecordInfoTask\(/.test(body)) labels.forEach((k) => withCredits.add(k))
      labels = []
      body = ""
      inBody = false
    }
    for (const line of poll.split("\n")) {
      const m = /^\s*case "([^"]+)":/.exec(line)
      if (m) {
        if (inBody) close()
        labels.push(m[1]!)
        seen.add(m[1]!)
        continue
      }
      if (labels.length > 0) {
        inBody = true
        body += line + "\n"
      }
    }
    close()
    for (const kind of KIE_RECOVER_KINDS) {
      if (BEFORE_SINGLE_POLL.has(kind)) continue
      expect(seen.has(kind), `${kind} has no case in singlePoll`).toBe(true)
    }
    const without = [...KIE_RECOVER_KINDS].filter((k) => !withCredits.has(k)).sort()
    expect(without).toEqual(Object.keys(NO_RECORD_KINDS).sort())
  })

  it("every completion call in lib/reconcile/kie.ts is listed with its cost rule", () => {
    const found: Record<string, Record<string, number>> = {}
    for (const [owner, body] of Object.entries(bodies())) {
      for (const m of stripComments(body).matchAll(CALL)) {
        // Skip the declarations of the recovery helpers themselves.
        if (/function \w+$/.test(stripComments(body).slice(0, m.index).trimEnd().split("\n").at(-1) ?? "")) continue
        ;(found[owner] ??= {})[m[1]!] = (found[owner]?.[m[1]!] ?? 0) + 1
      }
    }
    const expected = Object.fromEntries(Object.entries(COMPLETIONS).map(([o, calls]) => [o, Object.fromEntries(Object.entries(calls).map(([c, v]) => [c, v.count]))]))
    expect(found).toEqual(expected)
  })

  it("a function whose rule is 'recovered' computes its figure with kieRecoveredCostUsd, and no completion passes a bare cost: null", () => {
    const b = bodies()
    for (const [owner, calls] of Object.entries(COMPLETIONS)) {
      if (Object.values(calls).some((c) => c.rule === "recovered")) {
        expect(stripComments(b[owner] ?? ""), owner).toMatch(/\bkieRecoveredCostUsd\(/)
      }
    }
    expect(stripComments(KIE_TS)).not.toMatch(/\bcost:\s*null\b/)
  })

  it("every node unit's recover.ts records its cost through the rule, or is listed with why", () => {
    const units = readdirSync(NODES_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(NODES_DIR, d.name, "recover.ts")))
      .map((d) => d.name)
    expect(units.length).toBeGreaterThan(0)
    const notRouted = units.filter((u) => {
      const src = stripComments(readFileSync(join(NODES_DIR, u, "recover.ts"), "utf8"))
      return !/\bkie(?:Recovered|Billed)CostUsd\(/.test(src)
    })
    expect(notRouted.sort()).toEqual(Object.keys(RECOVER_TS_EXEMPT).sort())
  })
})
