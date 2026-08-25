/**
 * Every outbound provider HTTP call goes through providers/egress.ts::providerFetch.
 * A raw `fetch(` under providers/** would bypass decoration + observation
 * (identity headers, per-call modelKey, user-safe error marking) with NO runtime
 * signal — invisible until a proxy-backed deployment misbehaves. So the rule is
 * structural: no bare `fetch(...)` call under backend/src/providers/ except in
 * egress.ts (which defines the one wrapper) and a tiny justified allowlist.
 *
 * Built on source-scan.ts's AST helpers (parse once, substring pre-filter,
 * SCAN_TIMEOUT_MS) so it stays cheap on a shared CI runner.
 */
import { describe, it, expect } from "vitest"
import ts from "typescript"
import { SCAN_TIMEOUT_MS, walk, lineOf, parseText } from "../../lib/__tests__/source-scan.js"
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"

const PROVIDERS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..")

/** Justified exceptions, relative to providers/. */
const ALLOWLIST = new Set<string>([
  "egress.ts", // defines providerFetch — the one place `fetch` is allowed
  "nodaro/client.ts:LOCAL_PROBE", // local self-reachability probe, not a provider egress (see Task 7)
])

function providerSourceFiles(dir = PROVIDERS_DIR, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === "__tests__") continue
      providerSourceFiles(full, acc)
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      acc.push(full)
    }
  }
  return acc
}

const rel = (f: string) => relative(PROVIDERS_DIR, f).split(sep).join("/")

/** A bare `fetch(...)` call — callee is the identifier `fetch`, not a member access. */
function bareFetchCalls(sf: ts.SourceFile): number[] {
  const lines: number[] = []
  walk(sf, (n) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "fetch") {
      lines.push(lineOf(sf, n))
    }
  })
  return lines
}

describe("no raw fetch( under providers/**", () => {
  it("every provider HTTP call goes through providerFetch (egress.ts is the only fetch site)", () => {
    const offenders: string[] = []
    for (const file of providerSourceFiles()) {
      const relFile = rel(file)
      if (relFile === "egress.ts") continue
      const text = readFileSync(file, "utf8")
      if (!text.includes("fetch(")) continue // substring pre-filter (a superset of AST matches)
      const sf = parseText(file, text)
      const srcLines = text.split("\n")
      for (const line of bareFetchCalls(sf)) {
        // Allowlisted exception: the nodaro local self-reachability probe.
        // Per-LINE, not a window: the `local self-probe` marker must sit on the
        // fetch line ITSELF. A window would allow ANY raw fetch that happens to
        // land within two lines of a stray marker comment; scoping to the exact
        // line keeps the allowance to the one probe and names everything else.
        if (relFile === "nodaro/client.ts" && srcLines[line - 1].includes("local self-probe")) {
          continue
        }
        offenders.push(`${relFile}:${line}`)
      }
    }
    expect(offenders).toEqual([])
  }, SCAN_TIMEOUT_MS)

  it("the scanner distinguishes bare fetch from providerFetch/member calls (it IS the guard)", () => {
    const scan = (src: string) =>
      bareFetchCalls(ts.createSourceFile("t.ts", src, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS))
    expect(scan("const r = await fetch(u)")).toHaveLength(1)
    expect(scan("const r = await providerFetch(call, u, init)")).toHaveLength(0)
    expect(scan("const r = await heygenFetch(p)")).toHaveLength(0)
    expect(scan("const r = await client.fetch(u)")).toHaveLength(0)
    expect(scan("// fetch(u) in a comment")).toHaveLength(0)
    expect(scan("const r = await globalThis.fetch(u)")).toHaveLength(0)
  })

  it("provider SDK clients are constructed with an injected fetch, never bare", () => {
    // new Replicate(...) / fal.config(...) (and, defensively, new Anthropic(...) /
    // new GoogleGenAI(...)) must not appear under providers/** outside egress.ts
    // unless the same file injects egressSdkFetch — otherwise the SDK owns its
    // transport and bypasses the seam entirely.
    const offenders: string[] = []
    const forbidden = ["new Replicate(", "fal.config(", "new Anthropic(", "new GoogleGenAI("]
    for (const file of providerSourceFiles()) {
      const relFile = rel(file)
      if (relFile === "egress.ts") continue
      const text = readFileSync(file, "utf8")
      for (const pat of forbidden) {
        if (text.includes(pat) && !text.includes("egressSdkFetch")) {
          offenders.push(`${relFile} — ${pat} without egressSdkFetch`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it("the allowlist is documented", () => {
    // Present so a future reviewer sees WHY each raw-fetch exception exists.
    expect(ALLOWLIST.has("egress.ts")).toBe(true)
    expect(ALLOWLIST.has("nodaro/client.ts:LOCAL_PROBE")).toBe(true)
  })
})
