// @vitest-environment node
// @test-watches frontend/src/lib/surface-profile.ts backend/src/lib/surface-profile.ts
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"

/**
 * The frontend and backend SurfaceProfile shapes are two hand-kept copies
 * (cloud-only-nodes.ts precedent). This guard extracts the top-level key set of
 * each SURFACE_PROFILE_DEFAULT literal and asserts they match, so a field added
 * on one side and forgotten on the other fails CI. Substring pre-filter + a
 * cheap single-file read keep it well under the vitest ceiling.
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const FE = resolve(HERE, "..", "surface-profile.ts")
const BE = resolve(HERE, "..", "..", "..", "..", "backend", "src", "lib", "surface-profile.ts")

function defaultKeys(src: string): string[] {
  const start = src.indexOf("SURFACE_PROFILE_DEFAULT")
  expect(start, "SURFACE_PROFILE_DEFAULT literal must be present").toBeGreaterThan(-1)
  const brace = src.indexOf("{", start)
  // capture top-level keys of the literal (depth-1 identifiers before ':')
  let depth = 0
  const keys: string[] = []
  for (let i = brace; i < src.length; i++) {
    const c = src[i]
    if (c === "{") depth++
    else if (c === "}") {
      depth--
      if (depth === 0) break
    } else if (depth === 1) {
      const m = /^\s*([a-zA-Z_]+)\s*:/.exec(src.slice(i, src.indexOf("\n", i) + 1 || undefined))
      if (m && !keys.includes(m[1])) keys.push(m[1])
    }
  }
  return keys.sort()
}

describe("surface-profile drift", () => {
  it("frontend and backend SURFACE_PROFILE_DEFAULT expose the same top-level keys", () => {
    const fe = defaultKeys(readFileSync(FE, "utf8"))
    const be = defaultKeys(readFileSync(BE, "utf8"))
    expect(fe).toEqual(be)
  })
})

/**
 * Every member path of the file's `SurfaceProfile` interface — `auth.requireSignIn?`,
 * `worlds?.allow?`, `siblings.apps[].urlByHost?` — following inline object types,
 * arrays and the file's own interfaces. Wider than the default literal above,
 * which cannot see a key that is absent unless configured.
 */
function profileShape(file: string): string[] {
  const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true)
  const interfaces = new Map<string, ts.InterfaceDeclaration>()
  sf.forEachChild((n) => {
    if (ts.isInterfaceDeclaration(n)) interfaces.set(n.name.text, n)
  })
  const out: string[] = []
  const follow = (type: ts.TypeNode | undefined, path: string, seen: ReadonlySet<string>): void => {
    if (!type) return
    if (ts.isTypeLiteralNode(type)) walk(type.members, path, seen)
    else if (ts.isArrayTypeNode(type)) follow(type.elementType, `${path}[]`, seen)
    else if (ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName)) {
      const ref = interfaces.get(type.typeName.text)
      if (ref && !seen.has(ref.name.text)) walk(ref.members, path, new Set([...seen, ref.name.text]))
    }
  }
  const walk = (members: ts.NodeArray<ts.TypeElement>, prefix: string, seen: ReadonlySet<string>): void => {
    for (const m of members) {
      if (!ts.isPropertySignature(m)) continue
      const path = `${prefix ? `${prefix}.` : ""}${m.name.getText(sf)}${m.questionToken ? "?" : ""}`
      out.push(path)
      follow(m.type, path, seen)
    }
  }
  const root = interfaces.get("SurfaceProfile")
  expect(root, `${file} declares interface SurfaceProfile`).toBeDefined()
  walk(root!.members, "", new Set(["SurfaceProfile"]))
  return out.sort()
}

/**
 * Keys only the backend holds: surface-profile-runtime-config.ts strips them
 * from /config.js — the payer's billing keys, `jobs` (who reads a failed
 * job's provider words, decided by the server on every response) and `mcp`
 * (MCP by path: the server states every MCP address itself).
 */
const BACKEND_ONLY = [
  "billing.allowances?",
  "billing.defaultAllowanceUnits?",
  "billing.payerAccount?",
  "jobs?",
  "jobs?.errorDetail",
  "mcp?",
  "mcp?.byPath",
  "mcp?.path",
]

describe("surface-profile shape drift (nested members)", () => {
  it("frontend and backend SurfaceProfile declare the same members, nested and optional ones included", () => {
    const fe = profileShape(FE)
    const be = profileShape(BE)
    expect(fe).toContain("worlds?.allow?")
    expect(fe).toContain("auth.requireSignIn?")
    expect(fe).toEqual(be.filter((p) => !BACKEND_ONLY.includes(p)))
    expect(be.filter((p) => !fe.includes(p))).toEqual(BACKEND_ONLY)
  })
})

function tabKeys(src: string): string[] {
  const start = src.indexOf("DASHBOARD_TAB_KEYS")
  expect(start, "DASHBOARD_TAB_KEYS must be present").toBeGreaterThan(-1)
  const open = src.indexOf("[", start)
  const close = src.indexOf("]", open)
  return [...src.slice(open + 1, close).matchAll(/"([a-z]+)"/g)].map((m) => m[1]).sort()
}

describe("dashboard tab-key drift", () => {
  it("frontend and backend DASHBOARD_TAB_KEYS list the same members", () => {
    const fe = tabKeys(readFileSync(FE, "utf8"))
    const be = tabKeys(readFileSync(BE, "utf8"))
    expect(fe).toEqual(be)
    expect(fe).toContain("statistics")
    expect(fe).toContain("tutorials")
    expect(fe).toContain("miniapps")
  })
})
