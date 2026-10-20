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
import { describe, expect, it } from "vitest"
import ts from "typescript"
import { eachSourceFile, parseText, walk } from "./source-scan.js"
import { keyWrites } from "./execution-row-ast.js"
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
/**
 * A write, in any shape (lib/__tests__/execution-row-ast.ts `keyWrites`): a property
 * — plain, shorthand, or a string or `const` computed key — and a member assignment
 * or `delete`. A type's property, a destructuring target and prose are no writes.
 * A row whose keys the source does not show where it is inserted (a spread of a
 * row built elsewhere, a row handed in) fails `workflow-execution-inserts.test.ts`.
 */
function writesOf(sf: ts.SourceFile): { values: string[]; lanes: string[] } {
  const values = keyWrites(sf, "trigger_data").map((w) => w.value)
  // A `trigger_type:` value's lane literals: the quoted words in it.
  const lanes = keyWrites(sf, "trigger_type").flatMap((w) => {
    const literals: string[] = []
    walk(w.node, (n) => {
      if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && /^[a-z_]+$/.test(n.text)) literals.push(n.text)
    })
    return literals
  })
  return { values, lanes }
}

/**
 * Each file that writes `trigger_data`, and what it stores. `caller` files store data a caller
 * controls and must pass it through `withoutReservedStamps`.
 */
const WRITERS: Record<string, { readonly kind: "stamp" | "fixed" | "caller"; readonly values: readonly string[] }> = {
  "lib/continuation-run-root.ts": { kind: "stamp", values: ["{ ...kept, [STAMP_KEY]: { executionId: root } }"] },
  "lib/plugin-triggers.ts": { kind: "caller", values: ["triggerData"] },
  // The schedule lane's fire (the cron's fires and the retry sweep's retries): the fire time, the
  // schedule, the previous fire and a retry's own stamp (`retry`, lib/schedule-retry.ts) — read only
  // off a `schedule` row, which no caller can write.
  "lib/schedule-fire.ts": { kind: "fixed", values: ["{ timestamp: now.toISOString(), cron: config.cron, rules:…"] },
  "lib/trigger-fire-refusal.ts": { kind: "fixed", values: ["{ triggerId: args.triggerId }"] },
  "routes/webhook-triggers.ts": { kind: "caller", values: ["triggerData"] },
  "routes/telegram-webhook.ts": { kind: "fixed", values: ["triggerData"] },
  "routes/api-tokens.ts": { kind: "fixed", values: ["{ apiTokenId: resolved.id }"] },
  "routes/app-runner.ts": { kind: "stamp", values: ["appRunStamp(runId)"] },
  "routes/app-run-resume.ts": { kind: "stamp", values: ["appRunResumeStamp(runId, source.id)"] },
  // A continue-from-failed's lineage stamp, or a run's node selection (`nodeSelectionData`, the ids
  // the route itself was sent, restricted to the workflow's nodes): both platform-built, never caller data.
  "routes/workflow-execution.ts": { kind: "stamp", values: ["continueFromFailedStamp(lineageStamp)", "runSelection"] },
  "services/app-execution.ts": { kind: "stamp", values: ["appRunStamp(appRunId)"] },
  "services/app-render-final.ts": { kind: "stamp", values: ["appRenderFinalStamp({ appRunId: params.runId, appVersionI…"] },
}

describe("every trigger_data write is a platform stamp, fixed keys, or caller data without stamps", () => {
  const found = new Map<string, string[]>()
  const lanes = new Map<string, string[]>()
  const sourceOf = new Map<string, string>()
  eachSourceFile(["trigger_data", "trigger_type"], (sf, rel) => {
    const { values, lanes: literals } = writesOf(sf)
    if (values.length > 0) found.set(rel, values)
    if (literals.length > 0) lanes.set(rel, literals)
    sourceOf.set(rel, sf.text)
  })

  it("finds the writes (the guard is wired to something)", () => {
    expect(found.size).toBeGreaterThanOrEqual(Object.keys(WRITERS).length)
    expect(lanes.get("routes/workflow-execution.ts")).toEqual(["mcp", "manual"])
  })

  it("no write the list does not name", () => {
    const unnamed = [...found.keys()].filter((file) => !(file in WRITERS))
    expect(unnamed, "classify the new trigger_data write in WRITERS (and strip caller data with withoutReservedStamps)").toEqual([])
  })

  it("each named file writes what the list says", () => {
    for (const [file, spec] of Object.entries(WRITERS)) expect(found.get(file) ?? [], file).toEqual(spec.values)
  })

  it("a file storing caller data strips the stamps from it", () => {
    for (const [file, spec] of Object.entries(WRITERS)) {
      if (spec.kind !== "caller") continue
      expect(sourceOf.get(file) ?? "", file).toMatch(/withoutReservedStamps\(/)
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

describe("the writer guard sees trigger_data written in every shape (self-test)", () => {
  const valuesOf = (source: string) => writesOf(parseText("x.ts", source)).values

  it.each([
    ["a property", `insert({ trigger_data: body })`, ["body"]],
    ["a quoted key", `insert({ "trigger_data": body })`, ["body"]],
    ["shorthand", `const trigger_data = body\ninsert({ user_id, trigger_data })`, ["trigger_data"]],
    ["a computed string key", `insert({ ["trigger_data"]: body })`, ["body"]],
    ["a computed const key", `const COLUMN = "trigger_data"\ninsert({ [COLUMN]: body })`, ["body"]],
    ["a conditional spread", `insert({ ...(x ? { trigger_data: body } : {}) })`, ["body"]],
    ["a member assignment", `row.trigger_data = body`, ["body"]],
    ["an element assignment", `row["trigger_data"] ??= body`, ["body"]],
    ["a delete", `delete row.trigger_data`, ["delete"]],
  ])("%s", (_name, source, values) => {
    expect(valuesOf(source)).toEqual(values)
  })

  it("is no write: a type, a destructuring, a read, a select, prose", () => {
    expect(
      valuesOf(`
        type Row = { trigger_data: unknown; trigger_data2?: string }
        interface R { trigger_data: unknown }
        const { trigger_data: data } = row
        ;({ trigger_data: other } = row)
        const read = row.trigger_data
        supabase.from("workflow_executions").select("id, trigger_type, trigger_data")
        // trigger_data: body (a comment)
      `),
    ).toEqual([])
  })

  it("reads each lane a trigger_type names", () => {
    expect(writesOf(parseText("x.ts", `insert({ trigger_type: mcp ? "mcp" : "manual" })\nrow.trigger_type = "webhook"`)).lanes).toEqual(["mcp", "manual", "webhook"])
  })
})
