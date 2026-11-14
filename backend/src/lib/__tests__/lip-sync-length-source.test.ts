// @test-watches backend/src/**/*.ts
/**
 * Every Lip Sync model priced by the length of its audio is held and charged
 * on a length the SERVER measured (decided 2026-11-13), never on one a request
 * or a node carries. The rules that turn a length into a price — the bucket
 * (`buildLipSyncCreditId`, `pickLipSyncBucket`) and the whole seconds of a
 * per-second rate (`lipSyncBilledSeconds`) — are therefore applied, outside
 * an estimate, only where the length was measured:
 *   - lib/lip-sync-inputs.ts: the decoded length the price check (the route,
 *     a workflow run) and the worker measure;
 *   - ee/pipelines/services/pipeline-lip-sync.ts: a pipeline step's speech,
 *     which the pipeline generated itself and the server probed.
 * And one estimate, which holds and charges nothing:
 *   - ee/billing/credits.ts: the server's run estimate, at the length its
 *     audio wire gives, else the model's largest bucket (never below a run).
 * A new caller elsewhere would price a length nobody measured — add it to the
 * measured path instead. (The run estimate's `lipSyncEstimateSeconds` and the
 * editor's figures are estimates too.)
 */
import { describe, expect, it } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { dirname, join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"

const BACKEND_SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..")

/** A source without its comments, roughly (a doc may name what code may not). */
const stripComments = (text: string) => text.replace(/(^|\s)\/\*[\s\S]*?\*\//g, "$1 ").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1")

/** Every non-test TypeScript source under backend/src, relative to it (forward slashes). */
function sources(dir = BACKEND_SRC): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === "__tests__" || name === "node_modules" ? [] : sources(path)
    return name.endsWith(".ts") && !name.endsWith(".test.ts") ? [relative(BACKEND_SRC, path).split(sep).join("/")] : []
  })
}

/** The rules that turn an audio length into a lip-sync price, and where each may be applied. */
const LENGTH_PRICE_RULES: Readonly<Record<string, readonly string[]>> = {
  buildLipSyncCreditId: ["lib/lip-sync-inputs.ts", "ee/pipelines/services/pipeline-lip-sync.ts", "ee/billing/credits.ts"],
  pickLipSyncBucket: ["lib/lip-sync-inputs.ts"],
  lipSyncBilledSeconds: ["lib/lip-sync-inputs.ts"],
}

describe("a lip-sync price is applied only to a length the server measured", () => {
  const files = sources()

  it.each(Object.entries(LENGTH_PRICE_RULES))("%s is called only on the measured path", (rule, allowed) => {
    const call = new RegExp(`(^|[^.\\w])${rule}\\s*\\(`)
    const callers = files.filter((file) => call.test(stripComments(readFileSync(join(BACKEND_SRC, file), "utf8"))))
    expect(callers.sort()).toEqual([...allowed].sort())
  })

  it("the route and the workflow build never read a length a request or a node sent into a price", () => {
    const route = stripComments(readFileSync(join(BACKEND_SRC, "routes/lip-sync.ts"), "utf8"))
    const resolver = route.slice(route.indexOf("export function resolveLipSyncIdentifier"), route.indexOf("async function retiredLipSyncProviderPreHandler"))
    expect(resolver).not.toMatch(/audioDurationSec/)
    const builder = stripComments(readFileSync(join(BACKEND_SRC, "services/workflow-engine/payload-builder.ts"), "utf8"))
    const lipSyncCase = builder.slice(builder.indexOf('case "lip-sync": {'), builder.indexOf('case "lip-sync": {') + 4000)
    expect(lipSyncCase).not.toMatch(/(buildLipSyncCreditId|isPerSecondLipSyncProvider)\s*\(/)
  })
})
