/**
 * Every listing of other people's public work is the gallery, and takes the
 * gallery's moderation (lib/gallery-moderation.ts): blocked creators out of
 * the query, hidden items dropped after it. A file that filters jobs on
 * `is_public = true` without both calls would show what an admin took out.
 *
 * File-keyed on purpose, like the other totality guards here: a NEW file
 * that lists public jobs fails until it comes through the funnel, or is
 * named below with the reason it is not a listing.
 */
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const root = join(dirname(fileURLToPath(import.meta.url)), "../..")

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "__tests__" || entry.name === "node_modules") return []
    const path = join(dir, entry.name)
    return entry.isDirectory() ? files(path) : path.endsWith(".ts") ? [path] : []
  })
}

/**
 * Every spelling of "is_public = true" in a query: `.eq("is_public", true)`,
 * `.filter("is_public", "eq", true)`, `.match({ is_public: true })`, and the
 * PostgREST filter string `is_public.eq.true` (inside an `.or(…)`).
 */
const LISTS_PUBLIC_JOBS =
  /\.(?:eq\(\s*["'`]is_public["'`]\s*,\s*true\s*\)|filter\(\s*["'`]is_public["'`]\s*,\s*["'`]eq["'`]\s*,\s*true\s*\))|\.match\(\s*\{[^}]*\bis_public\s*:\s*true|\bis_public\.eq\.true\b/

/** Files that read `is_public = true` without listing the gallery, and why. */
const NOT_A_LISTING: Record<string, string> = {}

describe("gallery moderation totality", () => {
  it("every listing of public jobs comes through the moderation funnel", () => {
    const listing: string[] = []
    const bypassing: string[] = []
    for (const path of files(root)) {
      const text = readFileSync(path, "utf8")
      if (!LISTS_PUBLIC_JOBS.test(text)) continue
      const file = relative(root, path).split(sep).join("/")
      if (NOT_A_LISTING[file]) continue
      listing.push(file)
      if (!text.includes("bannedGalleryUsersFilter(") || !text.includes("galleryHides(")) bypassing.push(file)
    }
    expect(bypassing).toEqual([])
    // The known listings — a new one is added here on purpose, never silently.
    expect(listing.sort()).toEqual(["lib/mcp/tools/gallery.ts", "lib/mcp/tools/jobs.ts", "routes/gallery.ts"])
  })
})
