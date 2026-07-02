/**
 * Recipe catalog MCP tool — `get_recipe` discovers and loads multi-step
 * Nodaro "content recipes" (curated, terminal-verb-anchored playbooks like
 * `video-explainer`) from `backend/skills/recipes/<name>/RECIPE.md`.
 *
 * Each recipe file is a `---\n<yaml frontmatter>\n---\n<markdown body>`
 * document. The frontmatter (`name`, `description`, `triggers`, optional
 * `version`) powers the no-argument catalog listing; the body is the full
 * set of instructions returned when a specific recipe is requested.
 *
 * Loading strategy: mirrors `skill-loaders.ts` / `video-director.ts` — this
 * module resolves `backend/skills/recipes/` relative to its own compiled
 * location via `import.meta.url` (works from both `backend/src/...` under
 * tsx and `backend/dist/...` under the compiled build, since both sit four
 * levels deep under `backend/`), then reads recipe files directly off disk.
 * `backend/skills/` is shipped in the production Railway image (unlike
 * `.claude/`), so this works in development AND production.
 *
 * No scope gate: this is a content-delivery tool with no side effects, no
 * DB access, no API calls — same posture as `start_workflow_editor` /
 * `get_node_skill` / `start_video_director`.
 *
 * Registration: `registerRecipeTool` is wired into `registerVerbs` in
 * `verbs.ts`, ungated (no scope check) — pure content delivery, same posture
 * as `start_video_director` / `get_node_skill`.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { McpSession } from "../session.js"
import { z } from "zod"

export interface RecipeMeta {
  name: string
  description: string
  triggers: string[]
  version?: number
}

/**
 * Resolve `backend/skills/recipes/` relative to this module's compiled
 * location. In `npx tsc` output (rootDir = .., outDir = dist/) this file
 * becomes `backend/dist/lib/mcp/tools/recipes.js`, four levels deep from
 * `backend/`. In development (tsx watch) `import.meta.url` points at the
 * src file `backend/src/lib/mcp/tools/recipes.ts`, also four levels deep,
 * so the same `../../../../` traversal resolves correctly in both cases.
 */
function resolveRecipesDir(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  return resolve(here, "../../../../skills/recipes")
}

/**
 * Strict kebab-case validator for recipe names — enforced before any disk
 * read. No dots or slashes are ever allowed through, so this alone blocks
 * `..`-style traversal; the explicit prefix checks below are belt-and-braces
 * defense-in-depth, matching the pattern in `skill-loaders.ts`.
 */
const NAME_RE = /^[a-z0-9][a-z0-9-]*$/

/** Parse a `---\n...\n---\nbody` block. Throws if the fenced frontmatter is absent. */
export function parseRecipeFrontmatter(raw: string): { meta: RecipeMeta; body: string } {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!m) throw new Error("recipe frontmatter block missing")
  const yaml = m[1]
  const body = m[2].trimStart()
  const get = (k: string) => {
    const line = yaml.split("\n").find((l) => l.startsWith(`${k}:`))
    return line ? line.slice(k.length + 1).trim() : ""
  }
  const name = get("name")
  const description = get("description").replace(/^["']|["']$/g, "")
  const trigRaw = get("triggers")
  let triggers: string[] = []
  if (trigRaw.startsWith("[")) {
    triggers = trigRaw
      .replace(/^\[|\]$/g, "")
      .split(",")
      .map((s) => s.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean)
  }
  const versionRaw = get("version")
  if (!name || !description || triggers.length === 0) {
    throw new Error("recipe frontmatter incomplete (name/description/triggers)")
  }
  return {
    meta: { name, description, triggers, ...(versionRaw ? { version: Number(versionRaw) } : {}) },
    body,
  }
}

/**
 * Catalog every recipe under `backend/skills/recipes/` — one entry per
 * subdirectory that has a readable, well-formed `RECIPE.md`. Malformed or
 * unreadable recipes are skipped rather than throwing, so one broken recipe
 * folder never takes the whole catalog down.
 */
export function loadRecipeCatalog(): RecipeMeta[] {
  try {
    const dir = resolveRecipesDir()
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && NAME_RE.test(d.name))
      .map((d) => {
        const p = resolve(dir, d.name, "RECIPE.md")
        if (!existsSync(p)) return null
        try {
          return parseRecipeFrontmatter(readFileSync(p, "utf-8")).meta
        } catch {
          return null
        }
      })
      .filter((m): m is RecipeMeta => m != null)
      .sort((a, b) => a.name.localeCompare(b.name))
  } catch {
    return []
  }
}

/** Load a recipe's full body (frontmatter stripped). Null when unknown, unreadable, or malformed. */
export function loadRecipe(name: string): string | null {
  if (!NAME_RE.test(name)) return null
  const dir = resolveRecipesDir()
  const p = resolve(dir, name, "RECIPE.md")
  if (!p.startsWith(resolve(dir, name) + "/")) return null
  if (!existsSync(p)) return null
  try {
    return parseRecipeFrontmatter(readFileSync(p, "utf-8")).body
  } catch {
    return null
  }
}

/**
 * Read a bundled reference file inside a recipe folder, e.g.
 * `loadRecipeFile("video-explainer", "references/prompts.md")`. The
 * traversal guard resolves `relPath` against the recipe's own directory and
 * rejects any result that escapes it (`../../video-director/doctrine.md`
 * and similar), so a caller can never read outside its recipe folder.
 */
export function loadRecipeFile(name: string, relPath: string): string | null {
  if (!NAME_RE.test(name)) return null
  const base = resolve(resolveRecipesDir(), name)
  const target = resolve(base, relPath)
  if (!target.startsWith(base + "/")) return null // traversal guard
  if (!existsSync(target)) return null
  try {
    return readFileSync(target, "utf-8")
  } catch {
    return null
  }
}

/** Cached at module load — no per-invocation directory walk. */
const CATALOG = loadRecipeCatalog()

export function registerRecipeTool(server: McpServer, _session: McpSession): void {
  // No scope gate — pure content delivery, same posture as
  // start_workflow_editor / get_node_skill / start_video_director. The
  // actions a recipe instructs the LLM to take (e.g. assemble_narrated_video)
  // are themselves scope-gated by their own tools.
  server.registerTool(
    "get_recipe",
    {
      title: "Get Recipe",
      description:
        "Discover and load multi-step Nodaro content recipes. Call with NO argument to list available recipes (name, description, trigger phrases). Call with `recipe` to load that recipe's full instructions; add `file` to read a bundled reference file inside it. Use before building a narrated explainer video and similar multi-step flows.",
      inputSchema: {
        recipe: z.string().min(1).optional().describe("Recipe name, e.g. 'video-explainer'. Omit to list all."),
        file: z.string().min(1).optional().describe("Relative path inside the recipe folder, e.g. 'references/prompts.md'. Requires `recipe`."),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async (args: { recipe?: string; file?: string }) => {
      if (!args.recipe) {
        const list = CATALOG.map((r) => `- **${r.name}** — ${r.description}\n  triggers: ${r.triggers.join(", ")}`).join("\n")
        return { content: [{ type: "text" as const, text: list ? `Available recipes:\n${list}` : "No recipes available." }] }
      }
      if (args.file) {
        const f = loadRecipeFile(args.recipe, args.file)
        if (f == null) return { isError: true as const, content: [{ type: "text" as const, text: `No file '${args.file}' in recipe '${args.recipe}'.` }] }
        return { content: [{ type: "text" as const, text: f }] }
      }
      const body = loadRecipe(args.recipe)
      if (body == null) {
        const names = CATALOG.map((r) => r.name).join(", ") || "(none)"
        return { isError: true as const, content: [{ type: "text" as const, text: `No recipe '${args.recipe}'. Available: ${names}.` }] }
      }
      return { content: [{ type: "text" as const, text: body }] }
    },
  )
}
