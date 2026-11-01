// @test-watches backend/src/**/*.ts
// Every place that starts a workflow execution (an `orchestrationQueue.add(`)
// is classified for the run lane: TOP-LEVEL — a run a user, an API or MCP
// caller, an app, a webhook, a schedule or Telegram started, which takes a run
// slot — or NESTED-CAPABLE — a starter a node of a running run reaches (a
// component node through the component route, a use-case node through the
// use-case routes), which must carry `parentExecutionId` onto the job so the
// nested run takes no slot. A parent holding the last run slot would otherwise
// wait forever on a child waiting for one. A new site fails here until it is
// classified; a nested-capable site that stops carrying the parent fails too.
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { describe, expect, it } from "vitest"

const SRC = resolve(__dirname, "../../..")

/** Path under backend/src → how the run it starts takes the run lane. */
const SITES: Readonly<Record<string, "top-level" | "nested">> = {
  "lib/plugin-triggers.ts": "top-level",
  "lib/schedule-fire.ts": "top-level",
  "routes/app-runner.ts": "top-level",
  "routes/webhook-triggers.ts": "top-level",
  "routes/api-tokens.ts": "top-level",
  "routes/telegram-webhook.ts": "top-level",
  "routes/workflow-execution.ts": "top-level",
  "routes/presentation.ts": "top-level",
  "routes/app-run-resume.ts": "top-level",
  "services/app-render-final.ts": "top-level",
  // executeAppRun: the app runner (top-level) and the component route (nested when a node of a run called it).
  "services/app-execution.ts": "nested",
  // executeInlineGraph: the use-case run and continue routes (nested when a node of a run called them).
  "services/use-case-execution.ts": "nested",
}

/**
 * The routes that call a nested-capable starter, by starter: NESTED — a node
 * of a running run reaches it on the internal lane, so it must pass
 * `parentExecutionId: parentExecutionIdOf(req)` — or TOP-LEVEL, with why no
 * node of a run calls it.
 */
const STARTER_CALLERS: Readonly<Record<string, Readonly<Record<string, { kind: "nested" } | { kind: "top-level"; why: string }>>>> = {
  executeAppRun: {
    "routes/component-execute.ts": { kind: "nested" },
    "routes/app-runner.ts": { kind: "top-level", why: "a person (or their API / MCP client) runs a published app; the node executor never calls the app runner" },
  },
  executeInlineGraph: {
    "routes/use-case-run.ts": { kind: "nested" },
    "routes/use-case-continue.ts": { kind: "nested" },
  },
}

/** Every production .ts file under backend/src. */
function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (name !== "__tests__" && name !== "node_modules" && name !== "test") sources(path, out)
    } else if (name.endsWith(".ts") && !name.endsWith(".test.ts") && !name.endsWith(".d.ts")) {
      out.push(path)
    }
  }
  return out
}

/** Code only: a comment that mentions the call is not a site. */
const code = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1")

function addSites(): Map<string, string> {
  const found = new Map<string, string>()
  for (const file of sources(SRC)) {
    const body = code(readFileSync(file, "utf8"))
    if (/\borchestrationQueue\.add\(/.test(body)) found.set(relative(SRC, file).split("\\").join("/"), body)
  }
  return found
}

describe("orchestrationQueue.add census (the run lane)", () => {
  const found = addSites()

  it("every site that starts a workflow execution is classified top-level or nested", () => {
    const unclassified = [...found.keys()].filter((f) => !(f in SITES))
    expect(unclassified, "classify each new site in SITES: does a node of a running run reach it?").toEqual([])
  })

  it("every classified site still starts an execution (the list only names real sites)", () => {
    expect(Object.keys(SITES).filter((f) => !found.has(f))).toEqual([])
  })

  it("every caller of a nested-capable starter is classified, and each nested one passes the internal lane's parent", () => {
    for (const [starter, callers] of Object.entries(STARTER_CALLERS)) {
      const call = new RegExp(`\\b${starter}\\(`)
      const found = [...sources(SRC)]
        .map((file) => ({ file: relative(SRC, file).split("\\").join("/"), body: code(readFileSync(file, "utf8")) }))
        .filter(({ file, body }) => call.test(body) && !new RegExp(`export async function ${starter}\\(`).test(body))
      expect(found.map((f) => f.file).filter((f) => !(f in callers)).sort(), `classify each new caller of ${starter} in STARTER_CALLERS`).toEqual([])
      expect(Object.keys(callers).filter((f) => !found.some((x) => x.file === f)), `${starter}: listed callers that no longer call it`).toEqual([])
      for (const { file, body } of found) {
        const kind = callers[file]!
        if (kind.kind === "nested") expect(body, `${file} must pass parentExecutionId: parentExecutionIdOf(req) to ${starter}`).toMatch(/parentExecutionId:\s*parentExecutionIdOf\(req\)/)
        else expect(kind.why.length, `${file}: say why no node of a run calls it`).toBeGreaterThan(20)
      }
    }
  })

  it("every nested-capable site carries parentExecutionId onto the job", () => {
    const nested = Object.entries(SITES).filter(([, kind]) => kind === "nested").map(([f]) => f)
    expect(nested.length).toBeGreaterThan(0)
    for (const file of nested) expect(found.get(file), file).toMatch(/\bparentExecutionId\b/)
  })
})
