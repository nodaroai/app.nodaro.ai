/**
 * MCP tools run with the service-role client, so RLS does nothing for them —
 * every tenant-table read must scope itself explicitly, or it returns another
 * tenant's rows. This guards the one drift that is invisible until it leaks: a
 * NEW MCP tool added later that reads a tenant table and quietly forgets to
 * scope it.
 *
 * Crude on purpose (a source scan), and correct for exactly that failure. The
 * set is DERIVED, not hand-listed: every tool that reads one of the six tenant
 * tables must carry a scoping signal. The signals are the sanctioned ways a
 * tool bounds a read to the caller's tenant:
 *
 *   - `.eq("user_id", …)` / a `user_id:` insert payload — the personal floor.
 *     Never over-shows (it is the narrowest scope), and it is exactly what the
 *     REST entity routes ship, which the entity tools must match (issue #983).
 *   - `session.workspaceId` — an explicit workspace branch.
 *   - `mcpInject` — the read is delegated to a REST route, scoped there.
 *   - `loadMcpWorkflow` / `ensureMcpProject` — the workspace-aware seams, which
 *     apply user_id + the mcp-project floor (or the P10 access rule) internally.
 *
 * A tool that reads a tenant table with NONE of these is the leak, and the
 * acceptance test at the bottom proves this guard actually fires on one —
 * without it, a green guard could just be a guard that matches nothing (this
 * repo has shipped a lint rule that could never fire before, P8 §8a).
 *
 * `assets` is deliberately NOT a tenant table here: it has no workspace_id and
 * no project to join through, so it is personal-only in v1 (§2.4) and the
 * gallery tools stay `.eq("user_id")` by design.
 */
import { describe, expect, it } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const TOOLS_DIR = join(__dirname, "..", "lib", "mcp", "tools")

/** The tables whose rows belong to a tenant (a user, and flag-on a workspace). */
const TENANT_TABLES = ["workflows", "projects", "locations", "characters", "creatures", "objects"]
const TENANT_RE = new RegExp(`\\.from\\(["'](?:${TENANT_TABLES.join("|")})["']\\)`)
const SIGNAL_RE = /\buser_id\b|\bworkspaceId\b|\bmcpInject\b|\bloadMcpWorkflow\b|\bensureMcpProject\b/

/**
 * The per-tool units of a tools file: the module preamble (top-level helpers +
 * imports) followed by one chunk per `server.registerTool(` call. A helper file
 * with no `registerTool` is one unit — its whole body. Splitting per tool keeps
 * the check tool-granular AND immune to blank lines inside a handler.
 */
function toolChunks(source: string): Array<{ label: string; body: string }> {
  const parts = source.split("server.registerTool(")
  return parts.map((body, i) => {
    if (i === 0) return { label: "module-scope", body }
    const name = body.match(/["']([^"']+)["']/)?.[1] ?? `tool#${i}`
    return { label: name, body }
  })
}

/** Offender labels: `<file>:<toolNameOrScope>` for every unit that reads a
 *  tenant table with no scoping signal. Exported so the acceptance test can
 *  prove the predicate fires. */
export function findUnscopedTenantReads(source: string, file = "<fixture>"): string[] {
  const offenders: string[] = []
  for (const { label, body } of toolChunks(source)) {
    if (!TENANT_RE.test(body)) continue
    if (SIGNAL_RE.test(body)) continue
    offenders.push(`${file}:${label}`)
  }
  return offenders
}

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

describe("MCP tools: every tenant-table read carries a scoping signal", () => {
  it("no tool reads workflows/projects/locations/characters/creatures/objects unscoped", () => {
    const offenders: string[] = []
    for (const file of walk(TOOLS_DIR)) {
      const source = readFileSync(file, "utf8")
      offenders.push(...findUnscopedTenantReads(source, relative(TOOLS_DIR, file)))
    }
    expect(
      offenders,
      "each of these MCP tools reads a tenant table with no user_id / workspaceId / mcpInject / loadMcpWorkflow / ensureMcpProject signal — it will return other tenants' rows under the service-role client",
    ).toEqual([])
  })

  // Acceptance test for the test: a fixture that scopes nothing MUST be
  // reported, and a scoped one must not — otherwise a passing guard is
  // indistinguishable from a guard that matches nothing.
  it("fires on an unscoped fixture and stays silent on a scoped one", () => {
    const unscoped = `
      server.registerTool("leaky_tool", { title: "Leak" }, async () => {
        const { data } = await supabase.from("workflows").select("id, name")
        return ok(JSON.stringify(data))
      })`
    expect(findUnscopedTenantReads(unscoped)).toEqual(["<fixture>:leaky_tool"])

    const scopedPersonal = `
      server.registerTool("safe_tool", { title: "Safe" }, async () => {
        const { data } = await supabase.from("characters").select("id").eq("user_id", session.userId)
        return ok(JSON.stringify(data))
      })`
    expect(findUnscopedTenantReads(scopedPersonal)).toEqual([])

    // A workspace-scoped read with NO user_id filter — still safe, because the
    // workspace branch is the scope. Proves SIGNAL_RE accepts the P11 signal on
    // a real tenant `.from`, not only the personal `user_id` floor.
    const scopedWorkspace = `
      server.registerTool("ws_tool", { title: "WS" }, async () => {
        let q = supabase.from("projects").select("id")
        q = session.workspaceId ? q.eq("workspace_id", session.workspaceId) : q.is("workspace_id", null)
        return ok(JSON.stringify(await q))
      })`
    expect(findUnscopedTenantReads(scopedWorkspace)).toEqual([])
  })
})
