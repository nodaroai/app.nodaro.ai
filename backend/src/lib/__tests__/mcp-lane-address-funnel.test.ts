// @test-watches backend/src/lib/mcp/**/*.ts backend/src/routes/mcp.ts backend/src/routes/well-known.ts backend/src/routes/oauth.ts backend/src/routes/oauth-register.ts backend/src/routes/upload-proxy.ts backend/src/routes/upload-handoff.ts backend/src/middleware/mcp-host-filter.ts
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"

/**
 * Totality guard for the MCP lane's address funnel (lib/mcp-lane-addresses.ts,
 * decided 2026-11-11).
 *
 * Every absolute address the MCP lane states — the endpoint's resource, both
 * OAuth metadata documents, the 401 challenge, the consent redirect, the
 * links the MCP tools and widgets hand out — must come from one
 * `McpLaneAddresses`, because on a deployment that serves MCP by path each of
 * them must be on the host the client connected through. A site that builds
 * one from the install-wide sources instead (`PUBLIC_URL`, `MCP_PUBLIC_URL`,
 * `appBaseUrl()` / `mcpBaseUrl()` / `flowBaseUrl()` / `workflowEditorUrl()`,
 * or a hard-coded app / mcp host) keeps naming the primary host on every other
 * one, silently. This test fails the build on such a site in MCP code.
 *
 * Comments are stripped first (the TypeScript printer), so prose may name the
 * settings. A deliberate exception is a row in ALLOWED, with its reason; a row
 * that no longer matches anything fails too, so the list only shrinks.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = resolve(HERE, "..", "..")

/** The MCP lane's code: the MCP library, and the routes and middleware it is served through. */
const SCOPE_DIRS = ["lib/mcp"]
const SCOPE_FILES = [
  "routes/mcp.ts",
  "routes/well-known.ts",
  "routes/oauth.ts",
  "routes/oauth-register.ts",
  "routes/upload-proxy.ts",
  "routes/upload-handoff.ts",
  "middleware/mcp-host-filter.ts",
]

const BANNED: Array<{ what: string; re: RegExp }> = [
  { what: "config.PUBLIC_URL / config.MCP_PUBLIC_URL", re: /\bconfig\s*\.\s*(?:PUBLIC_URL|MCP_PUBLIC_URL)\b/ },
  { what: "process.env.PUBLIC_URL / MCP_PUBLIC_URL", re: /\bprocess\s*\.\s*env\s*\.\s*(?:PUBLIC_URL|MCP_PUBLIC_URL)\b/ },
  { what: "an install-wide base URL helper", re: /\b(?:appBaseUrl|mcpBaseUrl|flowBaseUrl|workflowEditorUrl|getStaticPublicAppUrl|getPublicAppUrl)\b/ },
  { what: "a hard-coded app or MCP host", re: /https?:\/\/(?:[a-z0-9-]+\.)*(?:app|mcp)\.nodaro\.ai/i },
]

/** Deliberate exceptions: [file (relative to backend/src), the banned text it may contain, why]. */
const ALLOWED: Array<{ file: string; text: string; why: string }> = [
  {
    file: "lib/mcp/tools/recast.ts",
    text: "config.PUBLIC_URL",
    why:
      "recastAppOrigin() picks which environment of the separate Recast product to deep-link (staging or production) " +
      "from PUBLIC_URL. That is another product's own host, not an address of this install's MCP lane.",
  },
]

function filesUnder(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      if (name === "__tests__") continue
      out.push(...filesUnder(full))
    } else if (name.endsWith(".ts") && !name.endsWith(".test.ts") && !name.endsWith(".d.ts")) {
      out.push(full)
    }
  }
  return out
}

function scopeFiles(): string[] {
  return [...SCOPE_DIRS.flatMap((d) => filesUnder(join(SRC, d))), ...SCOPE_FILES.map((f) => join(SRC, f))]
}

const printer = ts.createPrinter({ removeComments: true })
function withoutComments(file: string): string {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  return printer.printFile(source)
}

interface Finding {
  file: string
  what: string
  line: string
}

function findings(): Finding[] {
  const out: Finding[] = []
  for (const file of scopeFiles()) {
    const rel = relative(SRC, file)
    const lines = withoutComments(file).split("\n")
    for (const line of lines) {
      for (const banned of BANNED) {
        if (!banned.re.test(line)) continue
        if (ALLOWED.some((a) => a.file === rel && line.includes(a.text))) continue
        out.push({ file: rel, what: banned.what, line: line.trim() })
      }
    }
  }
  return out
}

describe("MCP lane address funnel", () => {
  it("covers the MCP lane's code (not vacuous)", () => {
    const files = scopeFiles()
    expect(files.length).toBeGreaterThan(60)
    for (const f of SCOPE_FILES) expect(files).toContain(join(SRC, f))
    // The sites that state addresses read them from the funnel.
    const reads = (f: string) => withoutComments(join(SRC, f))
    expect(reads("routes/mcp.ts")).toContain("mcpLaneAddresses(")
    expect(reads("routes/well-known.ts")).toContain("mcpLaneAddresses(")
    expect(reads("routes/oauth.ts")).toContain("mcpLaneAddresses(")
    expect(reads("lib/mcp/tools/upload.ts")).toContain("session.addresses.uploadProxyBase")
    expect(reads("lib/mcp/widgets/registrar.ts")).toContain("addresses.uploadPageBase")
  })

  it("no MCP code builds an MCP, OAuth, upload or page address from an install-wide source", () => {
    const found = findings()
    expect(
      found,
      found.map((f) => `${f.file}: ${f.what} — read it from the session's McpLaneAddresses (lib/mcp-lane-addresses.ts) instead:\n    ${f.line}`).join("\n"),
    ).toEqual([])
  })

  it("every allowed exception still matches something (the list only shrinks)", () => {
    for (const a of ALLOWED) {
      const text = withoutComments(join(SRC, a.file))
      expect(text.includes(a.text), `${a.file} no longer contains ${a.text}: remove its ALLOWED row`).toBe(true)
    }
  })

  it("catches what it is for (self-test on a planted line)", () => {
    const planted = [
      "const u = `${config.PUBLIC_URL}/v1/upload-page/${t}`",
      "const u = mcpBaseUrl() + '/mcp'",
      "import { flowBaseUrl as f } from '../../deployment-urls.js'",
      "const u = 'https://mcp.nodaro.ai/mcp'",
      "const u = process.env.MCP_PUBLIC_URL",
    ]
    for (const line of planted) expect(BANNED.some((b) => b.re.test(line)), line).toBe(true)
    expect(BANNED.some((b) => b.re.test("const u = `${session.addresses.uploadPageBase}/v1/upload-page/${t}`"))).toBe(false)
  })
})
