import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

/**
 * Frontend registration totality — the guard that was missing.
 *
 * Both `publish-social` (#233) and `telegram-channel-feed` (#235) shipped with
 * the BACKEND half of the New Node Registration checklist complete and the
 * FRONTEND half missing, and no CI check noticed: the existing parity tests
 * (sync-http-route-parity, payload-builder-registry-walk) assert backend maps
 * only. The symptoms were silent by construction —
 *
 *   step 16 skipped -> executeNode falls through every branch to the terminal
 *                      `return Promise.resolve("")`. Run does nothing at all:
 *                      no API call, no error, node stuck "pending" forever.
 *   step 17 skipped -> extractNodeOutput returns undefined and the input
 *                      resolver drops falsy outputs. The edge connects, the
 *                      node runs, and downstream just receives nothing.
 *
 * Neither throws, so nothing fails loudly. Hence a static guard: every type the
 * editor claims it can execute must be NAMED in the dispatcher, and every text
 * producer must be NAMED in the output extractor.
 *
 * Deliberately a source scan rather than a behavioural test. Driving the real
 * executeNode would need the store, the API client, and ~121 node fixtures
 * mocked; the failure mode here is "the string never appears", which a scan
 * catches exactly. Verified against history: run against the pre-fix tree this
 * reports `publish-social` and nothing else — no false positives across all
 * 121 executable types.
 */

const ROOT = resolve(__dirname, "../../../..") // -> frontend/src

function read(relative: string): string {
  return readFileSync(resolve(ROOT, relative), "utf8")
}

/** Source with comments removed, so prose inside a set literal is not mistaken
 *  for a member (a doc comment there quotes a phrase and would read as a type). */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")
}

/** String members of a `export const NAME ... = new Set([...])` literal. */
function setMembers(source: string, name: string): string[] {
  const body = stripComments(source)
  const start = body.indexOf(name)
  expect(start, `${name} not found — did it move or get renamed?`).toBeGreaterThan(-1)
  const open = body.indexOf("new Set([", start)
  expect(open, `${name} is no longer a \`new Set([...])\` literal`).toBeGreaterThan(-1)
  const close = body.indexOf("])", open)
  const inner = body.slice(open + "new Set([".length, close)
  return [...inner.matchAll(/"([^"]+)"/g)].map((m) => m[1]!)
}

describe("frontend registration totality", () => {
  it("every EXECUTABLE_TYPE is dispatched by executeNode (checklist step 16)", () => {
    const types = setMembers(read("components/editor/workflow-editor/types.ts"), "EXECUTABLE_TYPES")
    const dispatcher = read("components/editor/workflow-editor/execute-node.ts")

    expect(types.length).toBeGreaterThan(50) // sanity: the set actually parsed

    const undispatched = types.filter((t) => !dispatcher.includes(`"${t}"`))
    expect(
      undispatched,
      "These types are in EXECUTABLE_TYPES but never named in execute-node.ts, so Run " +
        "falls through to the terminal empty resolve and silently does nothing. " +
        "Add a dispatch block (New Node Registration step 16).",
    ).toEqual([])
  })

  it("every TEXT_PRODUCER_TYPE is handled by extractNodeOutput (checklist step 17)", () => {
    const types = setMembers(read("lib/generate-image-handles.ts"), "TEXT_PRODUCER_TYPES")
    const extractor = read("components/editor/workflow-editor/execution-graph.ts")

    expect(types.length).toBeGreaterThan(5)

    const unextracted = types.filter((t) => !extractor.includes(`"${t}"`))
    expect(
      unextracted,
      "These types produce text and connect downstream, but extractNodeOutput never " +
        "names them — it returns undefined and the input resolver drops it, so the " +
        "consumer receives nothing. Add a case (New Node Registration step 17).",
    ).toEqual([])
  })
})
