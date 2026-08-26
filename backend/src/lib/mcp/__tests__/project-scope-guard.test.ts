/**
 * `McpSession.scopedProjectId` pins an in-app session to one project. That is
 * safe ONLY while `project_id` stays a narrowing filter: wherever the MCP
 * tools read or compare `project_id`, the same block of code must also filter
 * on `user_id`, so a wrong project id can hide rows but never expose another
 * user's.
 *
 * Structural on purpose — the drift is a missing `user_id` next to a
 * `project_id` check, and that is where it has to be caught. The unit is a
 * blank-line-separated block (a query chain plus the `if` that reads its row),
 * which is how every site in `tools/` is written today.
 */
import { describe, expect, it } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const TOOLS_DIR = join(__dirname, "..", "tools")

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__") continue
      walk(full, out)
    } else if (entry.endsWith(".ts") && entry !== "_helpers.ts") {
      out.push(full)
    }
  }
  return out
}

describe("MCP tools: project_id is a narrowing filter, user_id is the authorization", () => {
  it("every block that reads or compares project_id also filters on user_id", () => {
    const offenders: string[] = []
    for (const file of walk(TOOLS_DIR)) {
      const source = readFileSync(file, "utf8")
      let offset = 0
      for (const block of source.split(/\n\s*\n/)) {
        const start = offset
        offset += block.length + 2
        if (!/\bproject_id\b/.test(block)) continue
        // Pure writes (`project_id: mcpProjectId` inside an insert payload)
        // are scoped by the insert's own user_id — same rule, same check.
        if (/\buser_id\b/.test(block)) continue
        // A by-id read delegated to the P10 seam is scoped INSIDE the helper:
        // `loadMcpWorkflow` filters user_id AND the mcp-project floor when there
        // is no workspace, and defers to the `workflowAccess` rule when there
        // is. Such a block names `project_id` only as a column to SELECT (part
        // of the cols string it hands the helper), never as its own unscoped
        // filter — the seam call is the authorization signal, and the helper
        // itself (`tools/_workflow-access.ts`) is scanned by this same guard.
        if (/\bloadMcpWorkflow\b/.test(block)) continue
        const line = source.slice(0, start).split("\n").length
        offenders.push(`${relative(TOOLS_DIR, file)}:${line}`)
      }
    }
    expect(offenders, "filter on user_id in the same block as every project_id read/compare").toEqual([])
  })
})
