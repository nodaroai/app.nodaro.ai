/**
 * Every place that creates a provider task and waits for it sends the task once
 * more when the provider timed it out on its own side.
 *
 * `retryOnProviderTaskTimeout` (client.ts) only helps a run that goes through
 * it, and nothing at run time says a new client forgot: the job just fails on
 * the provider's bad minute, as every model but one did before this rule. So
 * the rule is structural. A call to one of the provider's poll functions must
 * sit in one of three places:
 *
 *   1. inside the callback handed to `retryOnProviderTaskTimeout`,
 *   2. inside a function handed to `withProviderTimeoutRetry` in the same file,
 *   3. inside another poll function (one poll built on another).
 *
 * Anything else is a file that picks a task up again from its saved id. It has
 * no request to send again, and is listed below with that reason.
 *
 * The poll functions are read off the code (every `poll*` function declared
 * under providers/kie), so a new client's poll is held to the rule without an
 * edit here. File reads: source-scan.ts declares backend/src.
 */
import { describe, it, expect } from "vitest"
import ts from "typescript"
import { SCAN_TIMEOUT_MS, eachSourceFile, lineOf, parseText } from "../../../lib/__tests__/source-scan.js"

const RETRY = "retryOnProviderTaskTimeout"
const WRAP = "withProviderTimeoutRetry"

/** `pollDelay` computes a wait; it does not poll a task. */
const NOT_A_TASK_POLL = new Set(["pollDelay"])

/** Files that poll a task from its SAVED id, with no request in hand to send again. */
const RESUMES_A_SAVED_TASK: Record<string, string> = {
  "lib/reconcile/kie.ts": "the recovery lane reads a task a worker already created",
  "lib/private-plugins/toolkit.ts": "a plugin asks once for the state of a task it holds the id of",
}

const isPollName = (name: string) => /^poll[A-Z]/.test(name) && !NOT_A_TASK_POLL.has(name)

function calleeName(call: ts.CallExpression): string | null {
  return ts.isIdentifier(call.expression) ? call.expression.text : null
}

/** Names of functions this file hands to `withProviderTimeoutRetry(label, fn)`. */
function wrappedFunctionNames(sf: ts.SourceFile): Set<string> {
  const names = new Set<string>()
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && calleeName(n) === WRAP) {
      const fn = n.arguments[1]
      if (fn && ts.isIdentifier(fn)) names.add(fn.text)
    }
    n.forEachChild(visit)
  }
  visit(sf)
  return names
}

/** Poll calls that are not behind the retry, as `name:line`. */
function unguardedPollCalls(sf: ts.SourceFile, pollNames: ReadonlySet<string>): string[] {
  const wrapped = wrappedFunctionNames(sf)
  const found: string[] = []
  const visit = (n: ts.Node, guarded: boolean): void => {
    let inside = guarded
    if (ts.isFunctionDeclaration(n) && n.name) {
      // A function's own name decides for its body: a wrapped function and a
      // poll function are guarded, any other named function starts over.
      inside = wrapped.has(n.name.text) || pollNames.has(n.name.text)
    } else if (ts.isCallExpression(n)) {
      const name = calleeName(n)
      if (name === RETRY) inside = true
      else if (name && pollNames.has(name) && !guarded) found.push(`${name}:${lineOf(sf, n)}`)
    }
    n.forEachChild((child) => visit(child, inside))
  }
  visit(sf, false)
  return found
}

function declaredPollNames(): Set<string> {
  const names = new Set<string>()
  eachSourceFile(["function poll"], (sf, rel) => {
    if (!rel.startsWith("providers/kie/")) return
    const visit = (n: ts.Node): void => {
      if (ts.isFunctionDeclaration(n) && n.name && isPollName(n.name.text)) names.add(n.name.text)
      n.forEachChild(visit)
    }
    visit(sf)
  })
  return names
}

describe("a provider task timeout is retried wherever a task is created and waited for", () => {
  it("every poll of a newly created task is behind retryOnProviderTaskTimeout", () => {
    const pollNames = declaredPollNames()
    // The scan is the guard: an empty or shrunken list would pass everything.
    expect([...pollNames]).toEqual(expect.arrayContaining(["pollKieTask", "pollVeoRecordInfo", "pollSunoTask", "pollKling3Task"]))

    const offenders: string[] = []
    const exemptSeen = new Set<string>()
    eachSourceFile([...pollNames], (sf, rel) => {
      const calls = unguardedPollCalls(sf, pollNames)
      if (calls.length === 0) return
      if (rel in RESUMES_A_SAVED_TASK) {
        exemptSeen.add(rel)
        return
      }
      offenders.push(...calls.map((c) => `${rel} ${c}`))
    })
    expect(offenders).toEqual([])
    // The list only names files that still need it.
    expect(Object.keys(RESUMES_A_SAVED_TASK).filter((f) => !exemptSeen.has(f))).toEqual([])
  }, SCAN_TIMEOUT_MS)

  it("the scanner tells a guarded poll from a bare one (it IS the guard)", () => {
    const polls = new Set(["pollKieTask"])
    const scan = (src: string) => unguardedPollCalls(parseText("t.ts", src), polls)
    expect(scan("async function run() { const t = await create(); return pollKieTask(t) }")).toEqual(["pollKieTask:1"])
    expect(scan(`async function run() { return ${RETRY}("x", async () => { const t = await create(); return pollKieTask(t) }) }`)).toEqual([])
    expect(scan(`export const run = ${WRAP}("x", runOnce)\nasync function runOnce() { return pollKieTask(await create()) }`)).toEqual([])
    // Wrapping one function does not cover another in the same file.
    expect(scan(`export const run = ${WRAP}("x", runOnce)\nasync function runOnce() {}\nasync function other() { return pollKieTask("t") }`)).toEqual(["pollKieTask:3"])
    // One poll built on another.
    expect(scan("async function pollKieTask(id) { return pollKieTask(id) }")).toEqual([])
    // A function declared inside the retry's callback is still inside it.
    expect(scan(`async function run() { return ${RETRY}("x", async () => { const go = () => pollKieTask("t"); return go() }) }`)).toEqual([])
    expect(scan("// pollKieTask(t) in a comment")).toEqual([])
  })
})
