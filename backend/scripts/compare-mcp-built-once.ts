/**
 * STAGING ONLY, READ ONLY. Does a shared MCP build (MCP_TOOLS_BUILT_ONCE)
 * answer as a build per request does, on this deployment, with its private
 * plugins loaded?
 *
 * The tests compare the two paths with stand-ins for the plugins. This boots
 * the real app (buildApp, which loads the plugins as the API does; it starts no
 * worker or cron) and, for every grant connected clients hold (the distinct
 * `scopes_granted` of the authorizations not revoked, plus the empty grant of a
 * browser or API token), builds the MCP server both ways and compares the
 * handshake (`initialize`), `tools/list`, `resources/list` and
 * `resources/templates/list`. It calls no tool and changes no data; a shared
 * build that fails is logged and reported as it is for a request. It works
 * with the switch on or off: it asks both paths directly.
 *
 * Asked as a caller that is no user (not an admin, in no workspace), with a
 * conversation (as `/mcp` always has) and the install's primary addresses.
 * MCP_COMPARE_ADMIN_USER_ID=<an admin's user id> also compares an admin's view,
 * which differs where the Availability override hides nodes from users.
 *
 * It refuses to run unless MCP_COMPARE_STAGING_HOST names this deployment's
 * PUBLIC_URL host, and on a production host whatever is set
 * (scripts/lib/staging-only.ts).
 *
 * Usage, on a staging container, from backend/:
 *   MCP_COMPARE_STAGING_HOST=<PUBLIC_URL's host> npx tsx scripts/compare-mcp-built-once.ts
 * Exit 0: every shape answered the same. 1: a mismatch (named by grant and
 * first differing tool). 2: refused, or it could not run.
 */
import "dotenv/config"
import { stagingOnlyRefusal } from "./lib/staging-only.js"

const LOG = "[compare-mcp-built-once]"

/** A caller id no user has: asked as a user, in no workspace. */
const NO_USER = "00000000-0000-4000-8000-000000000000"

type Connectable = { connect(transport: import("@modelcontextprotocol/sdk/shared/transport.js").Transport): Promise<void> }

interface Answers {
  initialize: string
  tools: string
  resources: string
  templates: string
}

async function answersOf(server: Connectable): Promise<Answers> {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js")
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js")
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  await server.connect(serverSide)
  const client = new Client({ name: "compare-mcp-built-once", version: "1" })
  await client.connect(clientSide)
  try {
    return {
      initialize: JSON.stringify({ server: client.getServerVersion(), capabilities: client.getServerCapabilities(), instructions: client.getInstructions() ?? null }),
      tools: JSON.stringify(await client.listTools()),
      resources: JSON.stringify(await client.listResources()),
      templates: JSON.stringify(await client.listResourceTemplates()),
    }
  } finally {
    await client.close()
  }
}

/** The first tool whose listing differs, by name, for the report. */
function firstDifferingTool(a: string, b: string): string {
  const byName = (json: string) => new Map(((JSON.parse(json) as { tools?: Array<{ name: string }> }).tools ?? []).map((t) => [t.name, JSON.stringify(t)]))
  const [x, y] = [byName(a), byName(b)]
  for (const name of new Set([...x.keys(), ...y.keys()])) if (x.get(name) !== y.get(name)) return name
  return "(the list's order or envelope)"
}

async function main(): Promise<number> {
  const refusal = stagingOnlyRefusal(process.env)
  if (refusal) {
    console.error(`${LOG} refused: ${refusal}`)
    return 2
  }

  // Only now load the app: its config, its database client and its plugins.
  const { buildApp } = await import("../src/app.js")
  const { buildMcpServer } = await import("../src/lib/mcp/server.js")
  const { mcpServerForRequest } = await import("../src/lib/mcp/tools-built-once.js")
  const { mcpLaneAddresses } = await import("../src/lib/mcp-lane-addresses.js")
  const { supabase } = await import("../src/lib/supabase.js")

  const app = await buildApp()
  await app.ready()
  try {
    const { data, error } = await supabase.from("developer_app_authorizations").select("scopes_granted").is("revoked_at", null).limit(100_000)
    if (error) {
      console.error(`${LOG} could not read the grants: ${error.message}`)
      return 2
    }
    const grants = new Map<string, { scopes: string[]; authorizations: number }>([["", { scopes: [], authorizations: 0 }]])
    for (const row of (data ?? []) as Array<{ scopes_granted: string[] | null }>) {
      const scopes = [...new Set(row.scopes_granted ?? [])].sort()
      const key = scopes.join(" ")
      const entry = grants.get(key) ?? { scopes, authorizations: 0 }
      grants.set(key, { ...entry, authorizations: entry.authorizations + 1 })
    }
    const callers = [{ label: "a user", userId: NO_USER }]
    const admin = process.env.MCP_COMPARE_ADMIN_USER_ID?.trim()
    if (admin) callers.push({ label: "the given admin", userId: admin })

    console.info(`${LOG} ${grants.size} grants (${(data ?? []).length} authorizations not revoked), ${callers.length} caller(s)`)
    let mismatches = 0
    for (const [key, { scopes, authorizations }] of grants) {
      for (const caller of callers) {
        const opts = {
          userId: caller.userId,
          scopes: scopes as never,
          clientName: "compare-mcp-built-once",
          fastify: app,
          conversation: { client: "other" as const, key: null },
          addresses: mcpLaneAddresses(),
        }
        const own = await answersOf(await buildMcpServer(opts))
        const shared = await answersOf(await mcpServerForRequest(opts))
        const differs = (Object.keys(own) as Array<keyof Answers>).filter((k) => own[k] !== shared[k])
        const grant = key === "" ? "(no scopes)" : key
        if (differs.length === 0) {
          console.info(`${LOG} same: ${grant} [${authorizations} authorizations], ${caller.label}, ${(JSON.parse(own.tools) as { tools: unknown[] }).tools.length} tools`)
          continue
        }
        mismatches++
        const tool = differs.includes("tools") ? `, first differing tool: ${firstDifferingTool(own.tools, shared.tools)}` : ""
        console.error(`${LOG} DIFFERENT: ${grant}, ${caller.label}: ${differs.join(", ")}${tool}`)
      }
    }
    console.info(`${LOG} ${mismatches === 0 ? "every shape answered the same" : `${mismatches} shape(s) answered differently`}`)
    return mismatches === 0 ? 0 : 1
  } finally {
    await app.close()
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(`${LOG} failed:`, err)
    process.exit(2)
  },
)
