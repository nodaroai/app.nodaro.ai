// @test-always scans every tracked text file of the repository: a line naming a house model can be added anywhere
/**
 * A house model (a catalog entry marked `ownLabel`, docs/design/house-models.md)
 * is offered under the deployment's own label: the public platform names no
 * upstream, request or rate for it, and runs its task only through the
 * deployment's plugin. Three guards hold that boundary:
 *
 *   (a) no provider configuration names it — no file under
 *       `backend/src/providers/` mentions a house model's id or price id;
 *   (b) the house-model modules import nothing from the provider clients —
 *       `lib/house-model*.ts`, `lib/house-models*.ts`, the reconcile kind, and
 *       every module the lane table imports;
 *   (c) no line that names a house model (its id, a price id or its label)
 *       names a provider, and the house-model modules name none at all.
 *
 * The provider names (c) looks for are READ from the provider client folders
 * (`backend/src/providers/<name>/`), never written here: this file names no
 * provider. An upstream's model id or request field cannot be listed here
 * without publishing it; the private marker list the CI gate reads holds those.
 */
import { describe, it, expect } from "vitest"
import { execFileSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, extname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"
import { ownLabelModelIds } from "../house-models-served.js"

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..")
const LIB = join(REPO, "backend/src/lib")
const PROVIDERS = join(REPO, "backend/src/providers")

/** Folders under the provider clients that hold shared code by medium, not a provider's client. */
const NOT_A_PROVIDER = new Set(["__tests__", "audio", "image", "video", "script", "rss", "nodaro"])

/** The provider names: one client folder each under `backend/src/providers/`. */
const PROVIDER_NAMES: readonly string[] = readdirSync(PROVIDERS, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !NOT_A_PROVIDER.has(d.name))
  .map((d) => d.name)
const PROVIDER_WORD = new RegExp(`\\b(?:${PROVIDER_NAMES.join("|")})\\b`, "i")

const TEXT_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".md", ".mdx", ".sql", ".txt", ".yml", ".yaml", ".html", ".css"])
const MAX_BYTES = 2_000_000

/** Every term that names a house model: its id, each of its price ids, and its label. */
function houseModelTerms(ids: Iterable<string>): string[] {
  const terms = new Set<string>()
  for (const id of ids) {
    terms.add(id)
    const entry = MODEL_CATALOG[id]
    for (const row of entry?.pricing ?? []) terms.add(row.identifier)
    if (entry?.label) terms.add(entry.label)
  }
  return [...terms].filter((t) => t.length >= 4)
}

/** The lines of `text` that name one of `terms` and a provider: `[line number, line]`. */
function linesNamingBoth(text: string, terms: readonly string[]): Array<[number, string]> {
  if (terms.length === 0) return []
  const hits: Array<[number, string]> = []
  text.split("\n").forEach((line, i) => {
    if (terms.some((t) => line.includes(t)) && PROVIDER_WORD.test(line)) hits.push([i + 1, line.trim().slice(0, 160)])
  })
  return hits
}

/** The relative module specifiers a source file imports (static and dynamic). */
function importSpecifiers(source: string): string[] {
  const specs = new Set<string>()
  for (const m of source.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) specs.add(m[1]!)
  return [...specs]
}

/** Resolve a relative `.js` specifier of `fromFile` to its `.ts` source path. */
function resolveSource(fromFile: string, spec: string): string | undefined {
  if (!spec.startsWith(".")) return undefined
  const base = resolve(dirname(fromFile), spec)
  for (const candidate of [base.replace(/\.js$/, ".ts"), base, `${base}.ts`, join(base, "index.ts")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return undefined
}

/** The house-model modules: the seam's own files, the reconcile kind, and every module the lane table imports. */
function houseModelModules(): string[] {
  const own = [
    "house-models.ts",
    "house-models-served.ts",
    "house-model-failure.ts",
    "house-model-delivery.ts",
    "house-model-claim.ts",
    "house-model-lanes.ts",
    "house-model-timeouts.ts",
  ].map((f) => join(LIB, f))
  const lanes = join(LIB, "house-model-lanes.ts")
  const laneImports = importSpecifiers(readFileSync(lanes, "utf8"))
    .map((s) => resolveSource(lanes, s))
    .filter((p): p is string => p !== undefined)
  return [...new Set([...own, join(LIB, "reconcile/house-model.ts"), ...laneImports])]
}

function trackedTextFiles(): string[] {
  const out = execFileSync("git", ["ls-files", "-z"], { cwd: REPO, maxBuffer: 64 * 1024 * 1024 }).toString("utf8")
  return out
    .split("\0")
    .filter((f) => f && TEXT_EXTENSIONS.has(extname(f)) && !f.startsWith("graphify-out/"))
    .map((f) => join(REPO, f))
    .filter((p) => existsSync(p) && statSync(p).size <= MAX_BYTES)
}

describe("the guard's own scanners (fixtures, never a real model)", () => {
  it("reads the provider names from the client folders", () => {
    expect(PROVIDER_NAMES.length).toBeGreaterThan(3)
    for (const name of PROVIDER_NAMES) expect(existsSync(join(PROVIDERS, name))).toBe(true)
  })

  it("finds a line naming a house-model term and a provider, and only such a line", () => {
    const [first, second] = PROVIDER_NAMES
    const terms = ["house-fixture-model", "House Fixture"]
    const text = [
      "the house-fixture-model is great",
      `// runs on ${first!.toUpperCase()}`, // a provider, no term
      `House Fixture via ${first} behind the scenes`, // both
      `HOUSE-FIXTURE-MODEL on ${second}`, // a different case is a different term
    ].join("\n")
    expect(linesNamingBoth(text, terms).map(([n]) => n)).toEqual([3])
    expect(linesNamingBoth(text, [])).toEqual([])
  })

  it("reads static and dynamic imports", () => {
    expect(importSpecifiers(`import { a } from "./a.js"\nconst { b } = await import("../b.js")\nexport { c } from "./c.js"`).sort()).toEqual(["../b.js", "./a.js", "./c.js"])
  })
})

describe("house models name no upstream", () => {
  const ids = [...ownLabelModelIds()]
  const terms = houseModelTerms(ids)

  it("(a) no provider configuration names a house model", () => {
    const providerFiles = trackedTextFiles().filter((p) => p.startsWith(`${PROVIDERS}/`))
    expect(providerFiles.length).toBeGreaterThan(0)
    const named = providerFiles.filter((p) => {
      const text = readFileSync(p, "utf8")
      return terms.some((t) => text.includes(t))
    })
    expect(named.map((p) => relative(REPO, p)), "a provider file names a house model").toEqual([])
  })

  it("(b) the house-model modules import nothing from the provider clients", () => {
    const offenders: string[] = []
    for (const file of houseModelModules()) {
      for (const spec of importSpecifiers(readFileSync(file, "utf8"))) {
        const target = resolveSource(file, spec)
        if (target && target.startsWith(`${PROVIDERS}/`)) offenders.push(`${relative(REPO, file)} → ${spec}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it("(c) the house-model modules name no provider at all", () => {
    const named = houseModelModules()
      .map((file) => [relative(REPO, file), readFileSync(file, "utf8").split("\n").findIndex((l) => PROVIDER_WORD.test(l))] as const)
      .filter(([, i]) => i >= 0)
      .map(([file, i]) => `${file}:${i + 1}`)
    expect(named).toEqual([])
  })

  it("(c) no line in the repository names a house model and a provider", () => {
    const hits: string[] = []
    if (terms.length > 0) {
      for (const file of trackedTextFiles()) {
        for (const [n, line] of linesNamingBoth(readFileSync(file, "utf8"), terms)) hits.push(`${relative(REPO, file)}:${n}: ${line}`)
      }
    }
    expect(hits).toEqual([])
  })
})
