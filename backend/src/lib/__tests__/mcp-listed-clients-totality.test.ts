// @test-watches backend/src/**/*.ts backend/scripts/**/*.ts
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"

/**
 * Totality guard for the listed-clients funnel (lib/mcp-listed-clients.ts,
 * decided 2026-11-11). A deployment that sets `MCP_ALLOWED_CLIENT_IDS` must not
 * be reachable over MCP, or be signed in to for MCP, through any door that
 * does not ask the funnel. So this test fails the build when:
 *
 *  1. a file builds an MCP server, serves one over a transport, or constructs
 *     one directly, and is not a door that asks `admitMcpCaller` before it
 *     builds (the public endpoint) or a reasoned in-process entry below;
 *  2. a file issues an authorization code or mints an access token and does
 *     not ask `mcpSignInRefusal` (or a reasoned entry says why it need not);
 *  3. dynamic registration stops asking `registrationClosedByClientList`;
 *  4. a file other than the funnel and the boot check reads the list.
 *
 * A new credential kind is the type checker's job: the funnel's switch over
 * `authKind` is exhaustive, so a kind added to the auth hook fails typecheck
 * there until someone decides it (and refuses at run time meanwhile).
 *
 * Comments are stripped first (the TypeScript printer), so prose may name
 * anything. Every reasoned entry must still match a file, so the lists only
 * shrink.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const BACKEND = resolve(HERE, "..", "..", "..")

function filesUnder(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      if (name === "__tests__" || name === "node_modules" || name === "dist") continue
      out.push(...filesUnder(full))
    } else if (name.endsWith(".ts") && !name.endsWith(".test.ts") && !name.endsWith(".d.ts")) {
      out.push(full)
    }
  }
  return out
}

const printer = ts.createPrinter({ removeComments: true })
function code(file: string): string {
  const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true)
  return printer.printFile(sf)
}

const SOURCES: Array<{ rel: string; text: string }> = [...filesUnder(join(BACKEND, "src")), ...filesUnder(join(BACKEND, "scripts"))].map((f) => ({
  rel: relative(BACKEND, f).split("\\").join("/"),
  text: code(f),
}))

/** A call (not the definition) of `name`. */
function calls(text: string, name: string): boolean {
  return new RegExp(`(?<!function\\s+)\\b${name}\\s*\\(`).test(text)
}

describe("every MCP server a caller can reach asks the listed-clients funnel", () => {
  /** Files that build, serve or construct an MCP server, and why each is safe. */
  const DOORS: Record<string, { kind: "asks" } | { kind: "in-process" | "definition"; why: string }> = {
    "src/routes/mcp.ts": { kind: "asks" },
    "src/lib/mcp/server.ts": { kind: "definition", why: "Defines buildMcpServer — the one constructor of McpServer — and serves nothing itself." },
    "src/ee/copilot/turn-runner.ts": {
      kind: "in-process",
      why:
        "The in-app Workflow Copilot builds its server in-process for a browser session (its routes require req.authKind === \"jwt\") " +
        "and calls tools through createMcpInvoker; no transport is served, so no MCP client can reach it. Untouched by the list by decision.",
    },
    "scripts/lib/gen-skills/capture-mcp-schemas.ts": {
      kind: "in-process",
      why: "gen:skills builds a server at build time only to read the registered tools' schemas; it serves nobody.",
    },
  }

  const isDoor = (text: string) => calls(text, "buildMcpServer") || calls(text, "handleMcpRequest") || /\bnew\s+McpServer\s*\(/.test(text)

  it("names every file that builds or serves an MCP server", () => {
    const found = SOURCES.filter((s) => isDoor(s.text)).map((s) => s.rel).sort()
    expect(found).toEqual(Object.keys(DOORS).sort())
  })

  it("the public endpoint asks admitMcpCaller before it builds the server", () => {
    for (const [rel, door] of Object.entries(DOORS)) {
      if (door.kind !== "asks") continue
      const text = SOURCES.find((s) => s.rel === rel)!.text
      const asks = text.search(/\badmitMcpCaller\s*\(/)
      const builds = text.search(/\bbuildMcpServer\s*\(/)
      expect(asks, `${rel} must call admitMcpCaller`).toBeGreaterThan(-1)
      expect(asks, `${rel} must ask admitMcpCaller BEFORE buildMcpServer`).toBeLessThan(builds)
    }
  })
})

describe("every code and token the platform issues asks the sign-in rule", () => {
  const EXEMPT: Record<string, string> = {
    "src/routes/oauth-plugin-connect.ts":
      "Mints the token of a plugin connection whose consent went through POST /v1/oauth/authorize, which asked the rule; " +
      "it names no MCP resource, and its token is still refused on the MCP lane unless its client is listed.",
    "src/lib/oauth-tokens.ts": "Defines mintAppAccessToken; every caller is held here.",
    "src/lib/oauth-codes.ts": "Defines issueCode; every caller is held here.",
  }

  it("asks mcpSignInRefusal in every file that issues a code or mints a token", () => {
    const issuers = SOURCES.filter((s) => calls(s.text, "issueCode") || calls(s.text, "mintAppAccessToken"))
    expect(issuers.length).toBeGreaterThan(0)
    const missing = issuers.filter((s) => !EXEMPT[s.rel] && !calls(s.text, "mcpSignInRefusal")).map((s) => s.rel)
    expect(missing).toEqual([])
  })

  it("every exemption still names a file that issues", () => {
    for (const rel of Object.keys(EXEMPT)) {
      const src = SOURCES.find((s) => s.rel === rel)
      expect(src, rel).toBeDefined()
      const issues = calls(src!.text, "issueCode") || calls(src!.text, "mintAppAccessToken") || /\bfunction\s+(?:issueCode|mintAppAccessToken)\b/.test(src!.text)
      expect(issues, rel).toBe(true)
    }
  })

  it("the consent redirect, app-info, consent and the token exchange each ask it", () => {
    const oauth = SOURCES.find((s) => s.rel === "src/routes/oauth.ts")!.text
    // app-info, consent, token: three direct calls; the redirect asks through consentRedirectRefusal.
    expect(oauth.match(/\bmcpSignInRefusal\s*\(/g)?.length ?? 0).toBeGreaterThanOrEqual(4)
    expect(calls(oauth, "consentRedirectRefusal")).toBe(true)
  })
})

describe("registration and the list itself", () => {
  it("dynamic registration asks whether the list closes it", () => {
    const register = SOURCES.find((s) => s.rel === "src/routes/oauth-register.ts")!.text
    expect(calls(register, "registrationClosedByClientList")).toBe(true)
  })

  it("only the funnel and the boot check read MCP_ALLOWED_CLIENT_IDS", () => {
    const readers = SOURCES.filter((s) => /\bMCP_ALLOWED_CLIENT_IDS\b/.test(s.text)).map((s) => s.rel).sort()
    expect(readers).toEqual(["src/lib/config.ts", "src/lib/mcp-client-ids.ts", "src/lib/mcp-listed-clients.ts"])
  })
})
