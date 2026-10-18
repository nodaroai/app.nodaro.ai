// @test-watches backend/src/**/*.ts
/**
 * The platform's own `trigger_data` stamps (lib/trigger-data-stamps.ts): an app run's, a Render
 * final's, a continue-from-failed's lineage and a continuation chain's root. A run is found and
 * continued by them — its app version, its lineage — so a webhook body or a plugin trigger's event
 * that carried one would be read back as fact.
 *
 * - They are read only on a run a stamp-writing lane started (`serverStamps`,
 *   lib/server-started-runs.ts): on any other row they read as absent.
 * - Caller data never stores one (`withoutReservedStamps`).
 * - The totality guard: every `trigger_data` write in the backend is one of the platform's own
 *   stamps, fixed keys the lane builds itself, or caller data passed through
 *   `withoutReservedStamps` — and only a stamp is written on a run of a stamp-writing lane, so the
 *   trust `serverStamps` gives those lanes holds. A new write fails here until it is classified.
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { RESERVED_TRIGGER_DATA_KEYS, serverStamps, withoutReservedStamps } from "../trigger-data-stamps.js"
import { SERVER_STAMPED_TRIGGER_TYPES, isServerStartedRun, serverTriggerData } from "../server-started-runs.js"
import { appRunResumeStamp, appRunResumedFromOf, appRunStamp, appRunStampOf } from "../app-run-stamp.js"
import { appRenderFinalStamp, appRenderFinalStampOf } from "../app-run-final-column.js"
import { continueFromFailedStamp, continueFromFailedStampOf } from "../continue-from-failed-lineage.js"
import { RUN_ROOT_STAMP_KEY, runRootOf } from "../continuation-run-root.js"

const FORGED = {
  appRun: { appRunId: "run-of-someone" },
  appRenderFinal: { appRunId: "r", appVersionId: "v", continuedFrom: "e" },
  continueFromFailed: { from: "e", root: "root-of-someone", seededFrom: "e", all: true },
  runRoot: { executionId: "root-of-someone" },
}

/** What `serverStamps` reads on a row it cannot trust. */
const NONE = { continueFromFailed: null, appRun: null, appRenderFinal: null, runRoot: null, resumedFrom: null }

describe("caller data never carries a platform stamp", () => {
  it("every stamp is reserved", () => {
    expect([...RESERVED_TRIGGER_DATA_KEYS].sort()).toEqual(["appRenderFinal", "appRun", "continueFromFailed", "runRoot"])
  })

  it("a body carrying every stamp lands without them, and every other key as it was", () => {
    const body = { ...FORGED, message: "hello", nested: { runRoot: "kept: not top level" } }
    const stored = withoutReservedStamps(body)
    expect(stored).toEqual({ message: "hello", nested: { runRoot: "kept: not top level" } })
    expect(appRunStampOf(stored)).toBeNull()
    expect(appRenderFinalStampOf(stored)).toBeNull()
    expect(continueFromFailedStampOf(stored)).toBeNull()
    expect(runRootOf(stored)).toBeNull()
    // The input is left as it was.
    expect(body.runRoot).toEqual(FORGED.runRoot)
  })
})

describe("a stamp is read only on a run a stamp-writing lane started", () => {
  it("the stamp-writing lanes: the run route's and the app lanes'", () => {
    expect([...SERVER_STAMPED_TRIGGER_TYPES].sort()).toEqual(["app_run", "manual", "mcp"])
  })

  it("a row of any other lane reads as carrying none, whatever its trigger_data holds", () => {
    for (const trigger_type of ["webhook", "schedule", "telegram", "telegram_account", "api", "use_case", undefined, null, 7]) {
      const row = { trigger_type, trigger_data: FORGED }
      expect(isServerStartedRun(row)).toBe(false)
      expect(serverTriggerData(row)).toBeNull()
      expect(serverStamps(row)).toEqual(NONE)
    }
    // A row read without its trigger_type trusts nothing.
    expect(serverStamps({ trigger_data: FORGED })).toEqual(NONE)
    expect(serverStamps(null)).toEqual(NONE)
  })

  it("the platform's own stamps still read on its own rows", () => {
    expect(serverStamps({ trigger_type: "manual", trigger_data: appRunStamp("run-1") }).appRun).toBe("run-1")
    expect(serverStamps({ trigger_type: "app_run", trigger_data: appRunStamp("run-1") }).appRun).toBe("run-1")
    const final = { appRunId: "run-1", appVersionId: "v1", continuedFrom: "exec-0" }
    expect(serverStamps({ trigger_type: "app_run", trigger_data: appRenderFinalStamp(final) }).appRenderFinal).toEqual(final)
    const lineage = continueFromFailedStamp({ from: "exec-a", root: "exec-a", all: true })
    for (const trigger_type of ["manual", "mcp"]) {
      expect(serverStamps({ trigger_type, trigger_data: lineage }).continueFromFailed).toEqual({ from: "exec-a", root: "exec-a", all: true })
    }
    // A continuation chain's root (pinRunRoot) and an app run's Retry (routes/app-run-resume.ts).
    const pinned = { ...appRunStamp("run-1"), [RUN_ROOT_STAMP_KEY]: { executionId: "exec-root" } }
    expect(serverStamps({ trigger_type: "app_run", trigger_data: pinned }).runRoot).toBe("exec-root")
    const retry = serverStamps({ trigger_type: "app_run", trigger_data: appRunResumeStamp("run-1", "exec-failed") })
    expect([retry.appRun, retry.resumedFrom]).toEqual(["run-1", "exec-failed"])
    expect(appRunResumedFromOf(appRunStamp("run-1"))).toBeNull()
  })
})

// ── Totality: every trigger_data write is classified ──────────────────────────
const SRC = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..")
const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : sources(path)
    return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : []
  })

/** A write site: `trigger_data:` followed by the value it stores (a type annotation is not one). */
const WRITE = /trigger_data:\s*(?!\s|unknown\b)([^,\n]+)/g
/** A `trigger_type:` value; the lane literals in it are the quoted words. */
const TRIGGER_TYPE = /trigger_type:\s*([^,\n]+)/g

/**
 * Each file that writes `trigger_data`, and what it stores. `caller` files store data a caller
 * controls and must pass it through `withoutReservedStamps`.
 */
const WRITERS: Record<string, { readonly kind: "stamp" | "fixed" | "caller"; readonly values: readonly string[] }> = {
  "lib/continuation-run-root.ts": { kind: "stamp", values: ["{ ...kept"] },
  "lib/plugin-triggers.ts": { kind: "caller", values: ["triggerData"] },
  "lib/schedule-cron.ts": { kind: "fixed", values: ["{"] },
  "lib/trigger-fire-refusal.ts": { kind: "fixed", values: ["{ triggerId: args.triggerId } } : {})"] },
  "routes/webhook-triggers.ts": { kind: "caller", values: ["triggerData"] },
  "routes/telegram-webhook.ts": { kind: "fixed", values: ["triggerData"] },
  "routes/api-tokens.ts": { kind: "fixed", values: ["{ apiTokenId: resolved.id }"] },
  "routes/app-runner.ts": { kind: "stamp", values: ["appRunStamp(runId)"] },
  "routes/app-run-resume.ts": { kind: "stamp", values: ["appRunResumeStamp(runId"] },
  // A continue-from-failed's lineage stamp, or a run's node selection (`nodeSelectionData`, the ids
  // the route itself was sent, restricted to the workflow's nodes): both platform-built, never caller data.
  "routes/workflow-execution.ts": { kind: "stamp", values: ["continueFromFailedStamp(lineageStamp) }", "runSelection }"] },
  "services/app-execution.ts": { kind: "stamp", values: ["appRunStamp(appRunId)"] },
  "services/app-render-final.ts": { kind: "stamp", values: ["appRenderFinalStamp({"] },
}

describe("every trigger_data write is a platform stamp, fixed keys, or caller data without stamps", () => {
  const found = new Map<string, string[]>()
  const lanes = new Map<string, string[]>()
  for (const file of sources(SRC)) {
    const text = readFileSync(file, "utf8")
    const rel = relative(SRC, file).split("\\").join("/")
    const values = [...text.matchAll(WRITE)].map((m) => m[1]!.trim())
    if (values.length > 0) found.set(rel, values)
    const literals = [...text.matchAll(TRIGGER_TYPE)].flatMap((m) => [...m[1]!.matchAll(/"([a-z_]+)"/g)].map((l) => l[1]!))
    if (literals.length > 0) lanes.set(rel, literals)
  }

  it("finds the writes (the guard is wired to something)", () => {
    expect(found.size).toBeGreaterThanOrEqual(Object.keys(WRITERS).length)
    expect(lanes.get("routes/workflow-execution.ts")).toEqual(["mcp", "manual"])
  })

  it("no write the list does not name", () => {
    const unnamed = [...found.keys()].filter((file) => !(file in WRITERS))
    expect(unnamed, "classify the new trigger_data write in WRITERS (and strip caller data with withoutReservedStamps)").toEqual([])
  })

  it("each named file writes what the list says", () => {
    for (const [file, values] of found) {
      if (!(file in WRITERS)) continue
      expect(values, file).toEqual(WRITERS[file]!.values)
    }
  })

  it("a file storing caller data strips the stamps from it", () => {
    for (const [file, spec] of Object.entries(WRITERS)) {
      if (spec.kind !== "caller") continue
      expect(readFileSync(join(SRC, file), "utf8"), file).toMatch(/withoutReservedStamps\(/)
    }
  })

  it("a run of a stamp-writing lane is written with a platform stamp or nothing — never caller or lane data", () => {
    // `serverStamps` trusts these lanes' rows; that holds only while nothing else lands in them.
    const mixed = [...lanes.entries()]
      .filter(([, literals]) => literals.some((l) => SERVER_STAMPED_TRIGGER_TYPES.includes(l)))
      .filter(([file]) => found.has(file) && WRITERS[file]?.kind !== "stamp")
      .map(([file]) => file)
    expect(mixed, "a manual/mcp/app_run insert stores only a platform stamp in trigger_data").toEqual([])
  })

  it("a lane that stores caller or fixed data never inserts as a stamp-writing lane", () => {
    for (const [file, spec] of Object.entries(WRITERS)) {
      if (spec.kind === "stamp") continue
      const literals = lanes.get(file) ?? []
      expect(literals.filter((l) => SERVER_STAMPED_TRIGGER_TYPES.includes(l)), file).toEqual([])
    }
  })
})
