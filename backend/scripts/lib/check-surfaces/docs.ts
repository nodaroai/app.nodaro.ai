/**
 * What the public docs (docs/, packages/cli/README.md) name, per surface:
 *
 * - sdk-doc: SDK methods in docs/sdk-reference.md — inside a
 *   `### \`client.X\`` section, a `#### \`method(` (or bare `#### \`method\``)
 *   heading, a table row naming `` `method( ``, or a bare `method(` signature
 *   in a code block.
 * - cli-doc: `nodaro <group> <leaf>` in docs/cli.md and packages/cli/README.md.
 * - api-doc: `METHOD /v1/path` in the REST reference pages.
 * - mcp-doc: the hand-written entries of docs/mcp/tools.md (the generated
 *   tool-parameters page proves nothing, so it is not read).
 * - node-doc: docs/nodes/** pages plus their README row; node-doc-live: the
 *   docs-site snapshot the editor links to.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { normalizePath } from "../../../src/lib/route-inventory.js"
import { cliInvocations, nodeDocPages, readmeLinksNode } from "../../../src/lib/docs-inventory.js"
import { toolsDocEntries } from "../gen-skills/render-mcp-tools.js"

export const SDK_REFERENCE = "docs/sdk-reference.md"
export const CLI_DOCS = ["docs/cli.md", "packages/cli/README.md"] as const
export const MCP_TOOLS_DOC = "docs/mcp/tools.md"

/** The REST reference pages scanned for `METHOD /v1/path`. */
export function apiDocFiles(repoRoot: string): string[] {
  const listDir = (d: string) =>
    existsSync(join(repoRoot, d))
      ? readdirSync(join(repoRoot, d)).filter((f) => f.endsWith(".md")).sort().map((f) => `${d}/${f}`)
      : []
  return ["docs/api-integration.md", ...listDir("docs/api"), ...listDir("docs/features"), "docs/oauth-flow.md", "docs/organizations.md"].filter(
    (f) => existsSync(join(repoRoot, f)),
  )
}

export interface SdkDocs {
  /** SDK method key → `docs/sdk-reference.md:<line>`. */
  methods: Map<string, string>
  /** `### \`client.X\`` headings that appear more than once. */
  duplicateSections: string[]
}

/**
 * A `### \`client.X\`` section documents `X`; one that opens with
 * `` `client.X.Y.*` `` documents the nested resource `X.Y` instead.
 */
export function parseSdkReference(text: string, ref = SDK_REFERENCE): SdkDocs {
  const lines = text.split(/\r?\n/)
  const methods = new Map<string, string>()
  const seen = new Map<string, number>()
  const duplicates = new Set<string>()
  let prop: string | null = null
  let inFence = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (/^```/.test(line)) inFence = !inFence
    // A nested resource's signatures listed in its parent's section (a code
    // block is fine): `collaborators.add(workflowId, …)`.
    const nested = prop ? line.match(/^\s*([a-z][A-Za-z0-9]*)\.([a-z][A-Za-z0-9]*)\(/) : null
    if (nested) {
      const key = `${prop}.${nested[1]}.${nested[2]}`
      if (!methods.has(key)) methods.set(key, `${ref}:${i + 1}`)
    }
    // A fenced list of the section's bare signatures: `create(input)`. (The
    // fence-opening line is not inside the fence yet, so it never matches;
    // keys from example calls are harmless, only real SDK keys are looked up.)
    const bare = prop && inFence ? line.match(/^\s*(?:async\s+)?([a-z][A-Za-z0-9]*)\(/) : null
    if (bare) {
      const key = `${prop}.${bare[1]}`
      if (!methods.has(key)) methods.set(key, `${ref}:${i + 1}`)
    }
    if (inFence) continue
    // The client's own methods have a heading each: ### `client.me()`.
    const own = line.match(/^### `client\.([A-Za-z0-9]+)\(/)
    if (own) {
      if (!methods.has(`client.${own[1]}`)) methods.set(`client.${own[1]}`, `${ref}:${i + 1}`)
      prop = null
      continue
    }
    const section = line.match(/^### `client\.([A-Za-z0-9.]+)`\s*$/)
    if (section) {
      prop = section[1]!
      seen.set(prop, (seen.get(prop) ?? 0) + 1)
      if (seen.get(prop)! > 1) duplicates.add(`client.${prop}`)
      // A section for a nested resource names it in its first paragraph.
      for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
        const nested = lines[j]!.match(/^`client\.([A-Za-z0-9.]+)\.\*`/)
        if (nested) prop = nested[1]!
      }
      continue
    }
    if (/^#{1,3} /.test(line)) {
      prop = null
      continue
    }
    if (!prop) continue
    const named: string[] = []
    // `#### \`get(id)\`` or a bare `#### \`analyzeText\``.
    if (/^#### /.test(line)) for (const m of line.matchAll(/`([A-Za-z0-9]+)(?:\(|`)/g)) named.push(m[1]!)
    const row = line.match(/^\| `([A-Za-z0-9]+)\(/)
    if (row) named.push(row[1]!)
    for (const name of named) {
      const key = `${prop}.${name}`
      if (!methods.has(key)) methods.set(key, `${ref}:${i + 1}`)
    }
  }
  return { methods, duplicateSections: [...duplicates] }
}

/** Every CLI command path the CLI docs mention → its first `file:line`. */
export function cliDocMentions(repoRoot: string, commandPaths: readonly string[]): Map<string, string> {
  const out = new Map<string, string>()
  const byWords = new Set(commandPaths)
  for (const rel of CLI_DOCS) {
    const file = join(repoRoot, rel)
    if (!existsSync(file)) continue
    for (const inv of cliInvocations(readFileSync(file, "utf8"))) {
      // Longest prefix of the written words that is a real command path.
      for (let n = inv.words.length; n >= 1; n--) {
        const path = inv.words.slice(0, n).join(" ")
        if (byWords.has(path)) {
          if (!out.has(path)) out.set(path, `${rel}:${inv.line}`)
          break
        }
      }
    }
  }
  return out
}

export interface ApiDocMention {
  ref: string
  /** The enclosing `##` heading. */
  section: string
}

/**
 * `METHOD /v1/path` mentions in one REST reference page, keyed by atom key,
 * first mention wins. Both spellings count: prose (`GET /v1/x`, ``POST `/v1/x` ``)
 * and the reference tables' cells (`` | `GET` | `/v1/x/:id` | … ``).
 */
export function parseApiDoc(text: string, rel: string, out = new Map<string, ApiDocMention>()): Map<string, ApiDocMention> {
  let section = ""
  text.split(/\r?\n/).forEach((line, i) => {
    const h = line.match(/^## (.+)$/)
    if (h) section = h[1]!.trim()
    // The verb, its closing backtick, then at most one table-cell pipe before the path.
    for (const m of line.matchAll(/\b(GET|POST|PUT|PATCH|DELETE)`?\s*(?:\|\s*)?`?(\/v1\/[^\s`)|]+)/g)) {
      const raw = m[2]!.replace(/[.,;:]+$/, "")
      // `/x/*` names a family of sub-routes, not the route `/x` itself.
      if (/\/\*$/.test(raw)) continue
      // `/v1/upload*` is the route `/v1/upload` and its siblings: credit the stem.
      const path = normalizePath(raw.replace(/\*+$/, ""))
      if (!path) continue
      const key = `${m[1]} ${path}`
      if (!out.has(key)) out.set(key, { ref: `${rel}:${i + 1}`, section })
    }
  })
  return out
}

/** `METHOD /v1/path` mentions in the REST reference pages, keyed by atom key. */
export function apiDocMentions(repoRoot: string): Map<string, ApiDocMention> {
  const out = new Map<string, ApiDocMention>()
  for (const rel of apiDocFiles(repoRoot)) parseApiDoc(readFileSync(join(repoRoot, rel), "utf8"), rel, out)
  return out
}

/** MCP tool → `docs/mcp/tools.md:<line>` of its hand-written entry. */
export function mcpDocEntries(repoRoot: string): Map<string, string> {
  const entries = toolsDocEntries(readFileSync(join(repoRoot, MCP_TOOLS_DOC), "utf8"))
  return new Map([...entries].map(([name, line]) => [name, `${MCP_TOOLS_DOC}:${line}`]))
}

export interface NodeDocs {
  /** Node type → its docs/nodes page, when the README also links it. */
  pages: Map<string, { page: string; inReadme: boolean }>
  /** Node types the docs-site snapshot has a page for (sections ∪ aliases). */
  live: Set<string>
}

export async function nodeDocs(repoRoot: string): Promise<NodeDocs> {
  const readme = readFileSync(join(repoRoot, "docs/nodes/README.md"), "utf8")
  const pages = new Map<string, { page: string; inReadme: boolean }>()
  for (const [type, page] of nodeDocPages(repoRoot)) pages.set(type, { page, inReadme: readmeLinksNode(readme, type) })
  const snapshot = (await import(join(repoRoot, "frontend/src/lib/node-docs/node-docs-map.generated.ts"))) as {
    NODE_DOCS_SECTIONS: Record<string, unknown>
    NODE_DOCS_ALIASES: Record<string, string>
  }
  const live = new Set([...Object.keys(snapshot.NODE_DOCS_SECTIONS), ...Object.keys(snapshot.NODE_DOCS_ALIASES)])
  return { pages, live }
}
