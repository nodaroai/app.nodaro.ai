// @test-watches backend/src/**/*.ts supabase/migrations/*.sql
/**
 * `profiles.public_outputs` has exactly two writes, both in the user settings
 * route:
 *
 *  - `false` only through `makeOutputsPrivate` (lib/gallery-removal.ts →
 *    `make_outputs_private`, migration 706), which hides the person's existing
 *    gallery items in the same transaction. A plain write of `false` anywhere
 *    else (an admin tool, a plan downgrade) would leave their items public
 *    while telling them "private".
 *  - `true` as a plain preference write, which republishes nothing. A writer
 *    that also flipped `jobs.is_public` back on would break "switching back
 *    to public does not republish old items".
 *
 * A plan downgrade does not touch the column at all (Free/Basic simply cannot
 * turn private mode ON); this guard keeps it that way until someone decides
 * otherwise on purpose.
 */
import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, "..", "..", "..", "..")
const SRC = join(REPO, "backend", "src")
const MIGRATIONS = join(REPO, "supabase", "migrations")

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue
      out.push(...sourceFiles(path))
    } else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) {
      out.push(path)
    }
  }
  return out
}

/** `public_outputs: …` in an object literal, `.public_outputs = …`, or a SQL `public_outputs = …` in an update. */
const WRITE = /\bpublic_outputs\s*(?::(?!\s*boolean)|=(?!=))/

describe("profiles.public_outputs has one writer", () => {
  it("only the settings route writes it, and only `true` directly", () => {
    const writers = sourceFiles(SRC)
      .filter((path) => readFileSync(path, "utf8").split("\n").some((line) => WRITE.test(line) && !line.trim().startsWith("//") && !line.trim().startsWith("*")))
      .map((path) => relative(SRC, path))
    expect(writers).toEqual(["routes/user-settings.ts"])

    const route = readFileSync(join(SRC, "routes", "user-settings.ts"), "utf8")
    const writes = route.split("\n").filter((line) => WRITE.test(line) && !line.trim().startsWith("//") && !line.trim().startsWith("*"))
    expect(writes.map((line) => line.trim())).toEqual(["updates.public_outputs = true"])
    expect(route).toContain("makeOutputsPrivate(userId)")
  })

  it("no migration after 706 sets it outside make_outputs_private", () => {
    const later = readdirSync(MIGRATIONS)
      .filter((name) => /^\d{3}_.*\.sql$/.test(name) && Number(name.slice(0, 3)) > 706)
      .filter((name) => {
        // A later redefinition of make_outputs_private itself is the one allowed place.
        const sql = readFileSync(join(MIGRATIONS, name), "utf8").replace(
          /CREATE OR REPLACE FUNCTION public\.make_outputs_private[\s\S]*?\$\$[\s\S]*?\$\$/gi,
          "",
        )
        return /\bSET\s+public_outputs\b/i.test(sql)
      })
    expect(later).toEqual([])
  })
})
