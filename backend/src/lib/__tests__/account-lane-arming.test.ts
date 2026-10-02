/**
 * A Telegram ACCOUNT trigger reads the owner's own messages (and, with the
 * send node, replies as them). Two rules keep it the owner's:
 *
 * - Only the owner's own browser session ARMS, widens or re-points one: it is
 *   the only caller whose `accountNodes` (the triggers it changed, with the
 *   settings it set) reach `reconcileWorkflowTriggers`.
 * - Only a save made AS the owner reaches the lane at all (`ownerActing`): a
 *   token, a connected app or an MCP client can switch a trigger off there;
 *   an editor of a shared workflow cannot even do that.
 *
 * This guard pins every call site to those two values.
 */
import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const SRC = join(__dirname, "..", "..")

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === "__tests__" || name === "node_modules" ? [] : sourceFiles(path)
    return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : []
  })
}

/** The object-literal argument of every `reconcileWorkflowTriggers({ … })` call, with where it is. */
function reconcileCalls(): Array<{ where: string; text: string; argument: string }> {
  const calls: Array<{ where: string; text: string; argument: string }> = []
  for (const file of sourceFiles(SRC)) {
    const where = relative(SRC, file).replace(/\\/g, "/")
    const text = readFileSync(file, "utf8").replace(/\r\n/g, "\n")
    let from = 0
    for (;;) {
      const at = text.indexOf("reconcileWorkflowTriggers({", from)
      if (at < 0) break
      const open = at + "reconcileWorkflowTriggers(".length
      let depth = 0
      let end = open
      for (; end < text.length; end++) {
        if (text[end] === "{") depth += 1
        else if (text[end] === "}" && --depth === 0) break
      }
      calls.push({ where, text, argument: text.slice(open, end + 1) })
      from = end
    }
  }
  return calls
}

describe("arming the account trigger lane", () => {
  const calls = reconcileCalls()

  it("finds the call sites — the scan is looking in the right place", () => {
    expect(calls.map((c) => c.where).sort()).toEqual(["lib/mcp/tools/workflows.ts", "routes/workflows.ts"])
  })

  it("every call reaches the lane only for a save made AS the owner", () => {
    for (const { where, text, argument } of calls) {
      const value = /ownerActing:\s*([^,\n}]+)/.exec(argument)?.[1]?.trim()
      expect(value, `${where}: ownerActing must be passed`).toBeDefined()
      expect(["ownerIdentity", "false"], `${where}: ownerActing: ${value}`).toContain(value)
      if (value === "ownerIdentity") {
        expect(text, `${where}: ownerIdentity must be the caller being the owner`).toMatch(
          /const ownerIdentity = (req\.userId === ownerId|callerId === ownerId)\n/,
        )
      }
    }
  })

  it("only the owner's own browser session names the account triggers it changed", () => {
    for (const { where, text, argument } of calls) {
      const value = /accountNodes:\s*([^\n]+)/.exec(argument)?.[1]?.trim()
      if (value === undefined) continue
      expect(value, `${where}: accountNodes must come from the owner's session`).toMatch(/^ownerSession && /)
      expect(text, `${where}: ownerSession must be the owner's own JWT session`).toMatch(
        /const ownerSession = req\.authKind === "jwt" && req\.userId === ownerId\n/,
      )
    }
    expect(calls.filter((c) => /accountNodes:/.test(c.argument)).map((c) => c.where)).toEqual(["routes/workflows.ts"])
  })
})
