/**
 * The MCP tool surface of one edition: every tool, the scopes it needs and
 * its input schema, captured in a child process (capture-tool-surface.ts)
 * and rendered into the MCP docs by render-mcp-tools.ts.
 *
 * Why a child process per edition: the tool set follows the deployment's
 * config — the edition (cloud-only families register behind hasCredits()),
 * ORGS_ENABLED (the workspace tools), SCENE3D_ADVANCED_ENABLED (3D Render
 * Pro) — and config.ts reads it once, when first imported. So each edition
 * needs a fresh process, started with exactly the config it documents.
 */
import { spawn } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

export type Edition = "cloud" | "community"

/**
 * The scopes a tool needs: `null` when every client sees it, else `all` of
 * the listed scopes, or `any` one of them.
 */
export type ToolGate = null | { all: string[] } | { any: string[] }

export interface ToolSurface {
  edition: Edition
  /** Every OAuth scope, in the server's order. */
  scopes: string[]
  /** Tool name (sorted) → its gate and its input as JSON Schema. */
  tools: Record<string, { gate: ToolGate; input: Record<string, unknown> }>
}

const CHILD = join(dirname(fileURLToPath(import.meta.url)), "capture-tool-surface.ts")

/**
 * The child's WHOLE environment, and the config the docs describe: Nodaro
 * Cloud as production runs it, or a self-hosted Community install. Hermetic on
 * purpose — the parent's environment holds whatever a developer's .env set
 * (dotenv filled it), and CI has no .env, so inheriting it would make the
 * generated docs depend on the machine. `DOTENV_CONFIG_PATH` points dotenv at
 * a file that does not exist, and the other required values are stand-ins.
 */
function captureEnv(edition: Edition, missingEnvFile: string, databaseUrl: string): NodeJS.ProcessEnv {
  const deployment: NodeJS.ProcessEnv =
    edition === "cloud"
      ? { EDITION: "cloud", ORGS_ENABLED: "true", SCENE3D_ADVANCED_ENABLED: "true" }
      : { EDITION: "community" }
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    DOTENV_CONFIG_PATH: missingEnvFile,
    SUPABASE_URL: databaseUrl,
    SUPABASE_SERVICE_ROLE_KEY: "stub-service-role-key",
    INTERNAL_ORCHESTRATOR_SECRET: "gen-skills-capture-stand-in-secret-0000000000",
    ...deployment,
  }
}

/**
 * A database that answers every request at once with "not found", so a
 * registration that reads it (the stored workspace preference, on the cloud
 * capture) gets an immediate answer and the output never depends on data. A
 * refused connection would not do: the client retries network errors with
 * backoff, seven seconds per session build, and a capture builds dozens.
 */
async function startOfflineDatabase(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((_req, res) => {
    res.writeHead(404, { "content-type": "application/json" })
    res.end(JSON.stringify({ code: "PGRST205", message: "no database while capturing the MCP tool surface", details: null, hint: null }))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}

/** Capture one edition's tool surface in a fresh process. */
export async function captureToolSurface(edition: Edition, cwd: string): Promise<ToolSurface> {
  const dir = mkdtempSync(join(tmpdir(), "gen-skills-surface-"))
  const out = join(dir, `${edition}.json`)
  const database = await startOfflineDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      // process.execArgv carries the tsx loader, so the child runs TypeScript too.
      const child = spawn(process.execPath, [...process.execArgv, CHILD, out], {
        cwd,
        env: captureEnv(edition, join(dir, "no.env"), database.url),
        stdio: ["ignore", "ignore", "inherit"],
      })
      child.on("error", reject)
      child.on("exit", (code, signal) =>
        code === 0
          ? resolve()
          : reject(new Error(`capturing the ${edition} MCP tool surface failed (exit ${code ?? signal})`)),
      )
    })
    return JSON.parse(readFileSync(out, "utf8")) as ToolSurface
  } finally {
    await database.close()
    rmSync(dir, { recursive: true, force: true })
  }
}
