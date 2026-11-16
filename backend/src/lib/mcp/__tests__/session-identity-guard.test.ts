// @test-watches backend/src/lib/mcp/**/*.ts
/**
 * NO MCP CODE TREATS THE SESSION OBJECT AS AN IDENTITY.
 *
 * Where the tools are built once and shared (`MCP_TOOLS_BUILT_ONCE`,
 * tools-built-once.ts), every tool holds the same session object: a view that
 * answers the session of the request it is running for. Reading its fields is
 * exact. Using the object itself is not: a collection keyed by the session, a
 * comparison of two sessions by `===`, or a session kept past its call (pushed
 * into a list, held in a module variable) would be one object for every caller,
 * and would mix them. Compare and key by a field (`session.userId`) instead.
 */
import { describe, expect, it } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const MCP_DIR = join(dirname(fileURLToPath(import.meta.url)), "..")

const PATTERNS: ReadonlyArray<[string, RegExp]> = [
  ["a collection keyed by the session", /\b(?:Weak)?(?:Map|Set|Ref)<\s*(?:Pick<\s*)?McpSession\b/],
  ["a session used as a key", /\.(?:set|get|has|add|delete)\(\s*session\s*[,)]/],
  ["the session compared by identity", /[!=]==?\s*session\b(?![.?[])|\bsession\s*[!=]==?/],
  ["the session kept in a list", /\.(?:push|unshift)\(\s*session\s*\)/],
  ["the session kept in a module variable", /^(?:export\s+)?(?:let|var)\s+\w+\s*:\s*(?:Pick<\s*)?McpSession\b/],
]

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : sources(path)
    return name.endsWith(".ts") && !name.endsWith(".test.ts") ? [path] : []
  })
}

/** "file:line  reason  code" for every line one of `patterns` matches in `files`. */
function findings(files: readonly string[], read: (file: string) => string, patterns = PATTERNS): string[] {
  return files.flatMap((file) =>
    read(file)
      .split("\n")
      .flatMap((line, i) =>
        patterns.filter(([, re]) => re.test(line)).map(([reason]) => `${relative(MCP_DIR, file)}:${i + 1}  ${reason}  ${line.trim()}`),
      ),
  )
}

describe("MCP code reads the session's fields, never uses the object as an identity", () => {
  it("finds none in lib/mcp", () => {
    const files = sources(MCP_DIR)
    expect(files.length).toBeGreaterThan(50)
    expect(findings(files, (f) => readFileSync(f, "utf8"))).toEqual([])
  })

  it.each([
    ["const seen = new WeakMap<McpSession, string>()", "a collection keyed by the session"],
    ["cache.set(session, value)", "a session used as a key"],
    ["if (other === session) return", "the session compared by identity"],
    ["if (session !== last) reset()", "the session compared by identity"],
    ["pending.push(session)", "the session kept in a list"],
    ["let lastSession: McpSession | undefined", "the session kept in a module variable"],
  ])("catches %j", (line, reason) => {
    expect(findings(["probe.ts"], () => line)).toEqual([`${relative(MCP_DIR, "probe.ts")}:1  ${reason}  ${line}`])
  })

  it.each(["if (row.user_id !== session.userId) return", "const id = session?.userId ?? null", "w.id === session.workspaceId"])("leaves a field read alone: %j", (line) => {
    expect(findings(["probe.ts"], () => line)).toEqual([])
  })
})
