// @test-watches backend/src/lib/mcp/**/*.ts
/**
 * NO CALLBACK THAT RUNS LATER, FOR WHOEVER TRIGGERS IT, READS THE SESSION.
 *
 * Where the tools are built once and shared (`MCP_TOOLS_BUILT_ONCE`,
 * tools-built-once.ts), a tool's `session` answers the caller of the request
 * the code is running for, found from the async context it runs in. A callback
 * one caller leaves behind runs in the context of whatever fires it: an event
 * listener runs in the context of the code that emits, a queued callback in the
 * context of the code that drains the queue. Such a callback that reads
 * `session` would read the caller who triggered it, not the caller who
 * registered it, whenever the tools are shared. (With every request building its
 * own tools, the same callback reads its own caller.) A repeating timer keeps
 * its creator's context, so it would keep reading a caller whose request ended.
 *
 * So in lib/mcp, a callback passed to `.on` / `.once` / `.addListener` /
 * `.prependListener` / `.prependOnceListener` / `addEventListener` /
 * `.subscribe` / `setInterval` / `setImmediate`, or stored with
 * `.push` / `.unshift` / `.add` / `.set` as a function, may not mention
 * `session`. Read what the callback needs from the session before registering
 * it, and pass the value in.
 *
 * WHAT IT CANNOT SEE:
 *  - a callback passed by name (`emitter.on("x", listener)`) whose body is
 *    written elsewhere;
 *  - the session reached under another name (`const s = session`, a field of
 *    `opts`, a helper that takes it), or another per-call value read by such a
 *    callback (it looks for the word `session` only);
 *  - a callback stored by any other API (a library's own registry, a promise
 *    kept in a module map and resolved by another request), and a callback
 *    registered by code outside lib/mcp that a tool calls.
 * The isolation test (tools-built-once-isolation.test.ts) checks the callers
 * the tools have today; this guard only keeps the common shapes out.
 */
import { describe, expect, it } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const MCP_DIR = join(dirname(fileURLToPath(import.meta.url)), "..")

/** A call that stores its callback to run later, for whoever triggers it. */
const STORES_A_CALLBACK =
  /\.(?:on|once|addListener|prependListener|prependOnceListener|addEventListener|subscribe)\s*\(|\b(?:setInterval|setImmediate)\s*\(|\.(?:push|unshift|add)\s*\(\s*(?:async\s+)?(?:\(|function\b|[A-Za-z_$][\w$]*\s*=>)|\.set\s*\([^,()]*,\s*(?:async\s+)?(?:\([^)]*\)\s*=>|function\b|[A-Za-z_$][\w$]*\s*=>)/g

/** Code without comments (a comment naming the session is not a read). */
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

/** The text of the call's arguments: from its `(` to the one that closes it. */
function argumentsOf(text: string, open: number): string {
  let depth = 0
  for (let i = open; i < text.length; i++) {
    const c = text[i]
    if (c === "(") depth++
    else if (c === ")" && --depth === 0) return text.slice(open, i + 1)
  }
  return text.slice(open)
}

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : sources(path)
    return name.endsWith(".ts") && !name.endsWith(".test.ts") ? [path] : []
  })
}

/** "file:line  code" for every stored callback in `files` that mentions the session. */
function findings(files: readonly string[], read: (file: string) => string): string[] {
  return files.flatMap((file) => {
    const text = code(read(file))
    return [...text.matchAll(STORES_A_CALLBACK)].flatMap((match) => {
      // Every pattern starts at the call: its first `(` opens the arguments.
      const args = argumentsOf(text, text.indexOf("(", match.index!))
      if (!/\bsession\b/.test(args)) return []
      const line = text.slice(0, match.index!).split("\n").length
      return [`${relative(MCP_DIR, file)}:${line}  ${text.split("\n")[line - 1]!.trim()}`]
    })
  })
}

describe("callbacks stored to run later never read the session", () => {
  it("finds none in lib/mcp", () => {
    const files = sources(MCP_DIR)
    expect(files.length).toBeGreaterThan(50)
    expect(findings(files, (f) => readFileSync(f, "utf8"))).toEqual([])
  })

  it.each([
    ["an event listener", 'emitter.on("done", () => notify(session.userId))'],
    ["a one-time listener", 'events.once(jobId, (e) => record(e, session.clientName))'],
    ["a DOM-style listener", 'signal.addEventListener("abort", () => cancel(session.userId))'],
    ["a subscription", "channel.subscribe(async (msg) => { await save(msg, session) })"],
    ["a repeating timer", "setInterval(() => poll(session.userId), 1000)"],
    ["a deferred run", "setImmediate(() => audit(session))"],
    ["a queued callback", "pending.push(() => finish(session.userId))"],
    ["a callback added to a set", "listeners.add((event) => forward(event, session))"],
    ["a callback kept in a map", "waiters.set(jobId, (result) => reply(result, session.userId))"],
  ])("catches %s", (_name, line) => {
    expect(findings(["probe.ts"], () => line)).toHaveLength(1)
  })

  it.each([
    ["a listener that reads nothing of the session", 'signal?.addEventListener("abort", done, { once: true })'],
    ["a value read before the listener is registered", 'const userId = session.userId\nemitter.on("done", () => notify(userId))'],
    ["a one-shot timer, which keeps its creator's context", "setTimeout(() => resolve(session.userId), 10)"],
    ["a value pushed, not a callback", "rows.push(session.userId)"],
    ["a map set to a value", "totals.set(session.userId, (totals.get(session.userId) ?? 0) + 1)"],
  ])("leaves %s alone", (_name, text) => {
    expect(findings(["probe.ts"], () => text)).toEqual([])
  })
})
