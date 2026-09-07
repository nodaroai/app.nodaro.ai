import { describe, it, expect } from "vitest"
import { readFileSync, statSync } from "node:fs"
import path from "node:path"

/**
 * `/embed/scene3d` must not be able to authenticate. Not "does not today" — must
 * not be ABLE to.
 *
 * The frame is loaded by pages Nodaro does not control. It holds no session, so
 * there is nothing in it to leak; that property is only worth anything if it
 * cannot be undone by a well-meaning refactor that reaches for `nodaroClient`
 * inside a component the embed happens to render. A runtime branch ("only build
 * an authenticated resolver when none was passed") cannot be asserted; an
 * import graph can.
 *
 * So this walks the STATIC imports from the route and fails if any of them
 * reaches the API client, the Supabase client or the SDK. The editor gets its
 * authorized bytes from a separate module
 * (`scene3d-preview-authenticated.tsx`) that the embed never imports.
 */
const SRC = path.resolve(__dirname, "../../..")
const ENTRY = path.join(SRC, "routes/embed-scene3d-page.tsx")

/** Modules that mean "this file can obtain a credential". */
const BANNED = [
  { pattern: /(^|\/)nodaro-client$/, label: "@/lib/nodaro-client" },
  { pattern: /(^|\/)supabase$/, label: "@/lib/supabase" },
  { pattern: /(^|\/)authenticated-asset-resolver$/, label: "the authenticated asset resolver" },
]
const BANNED_PACKAGES = ["@nodaro/sdk", "@supabase/supabase-js"]

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*["']([^"']+)["']/g
const BARE_IMPORT_RE = /(?:^|\n)\s*import\s*["']([^"']+)["']/g
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g

function specifiersIn(source: string): string[] {
  const found: string[] = []
  for (const re of [IMPORT_RE, BARE_IMPORT_RE, DYNAMIC_IMPORT_RE]) {
    re.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = re.exec(source)) !== null) found.push(match[1])
  }
  return found
}

/** Resolve a specifier to a file under `src/`, or `null` when it is a package. */
function resolveLocal(specifier: string, fromFile: string): string | null {
  const base = specifier.startsWith("@/")
    ? path.join(SRC, specifier.slice(2))
    : specifier.startsWith(".")
      ? path.resolve(path.dirname(fromFile), specifier)
      : null
  if (!base) return null
  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    base,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ]) {
    try {
      if (statSync(candidate).isFile()) return candidate
    } catch {
      // Not there — try the next spelling.
    }
  }
  return null
}

/** Every module the entry reaches through static or dynamic imports. */
function importGraph(entry: string): Map<string, string[]> {
  const graph = new Map<string, string[]>()
  const queue = [entry]
  while (queue.length > 0) {
    const file = queue.shift()!
    if (graph.has(file)) continue
    const source = readFileSync(file, "utf8")
    const specifiers = specifiersIn(source)
    graph.set(file, specifiers)
    for (const specifier of specifiers) {
      const resolved = resolveLocal(specifier, file)
      if (resolved && !graph.has(resolved)) queue.push(resolved)
    }
  }
  return graph
}

describe("/embed/scene3d cannot authenticate", () => {
  it("reaches no API client, Supabase client or SDK — through any import", () => {
    const graph = importGraph(ENTRY)
    const offences: string[] = []

    for (const [file, specifiers] of graph) {
      for (const specifier of specifiers) {
        for (const { pattern, label } of BANNED) {
          if (pattern.test(specifier)) {
            offences.push(`${path.relative(SRC, file)} imports ${label} (${specifier})`)
          }
        }
        if (BANNED_PACKAGES.includes(specifier)) {
          offences.push(`${path.relative(SRC, file)} imports ${specifier}`)
        }
      }
    }

    expect(offences).toEqual([])
    // The walk must actually have covered the panel, or the assertion above is
    // vacuously true.
    const walked = [...graph.keys()].map((file) => path.relative(SRC, file))
    expect(walked).toContain("components/editor/scene3d/scene3d-preview.tsx")
    expect(walked).toContain("components/editor/scene3d/scene3d-v2-preview.tsx")
    expect(walked).toContain("lib/scene3d/embed-asset-transport.ts")
  })

  it("proves the guard has teeth — the EDITOR's wrapper is the module that has auth", () => {
    const wrapper = path.join(SRC, "components/editor/scene3d/scene3d-preview-authenticated.tsx")
    const resolver = path.join(SRC, "lib/scene3d/authenticated-asset-resolver.ts")
    // The authenticated path exists and does reach the client…
    expect(specifiersIn(readFileSync(resolver, "utf8"))).toContain("@/lib/nodaro-client")
    expect(specifiersIn(readFileSync(wrapper, "utf8"))).toContain(
      "@/lib/scene3d/authenticated-asset-resolver",
    )
    // …and the embed reaches neither.
    expect([...importGraph(ENTRY).keys()]).not.toContain(wrapper)
  })
})
