import { readFile, readdir } from "node:fs/promises"
import { join, resolve } from "node:path"
import { parsePackManifest, validatePackDoc } from "./pack-validator.js"
import type { LoadedPack, PackIssue, TutorialTemplateDoc } from "./types.js"

/** Split NODARO_TUTORIAL_PACKS into resolved directory paths. Comma-separated
 *  (the repo's list convention), trimmed, empties dropped. */
export function parsePackDirList(env: string | undefined): string[] {
  if (!env) return []
  return env.split(",").map((s) => s.trim()).filter((s) => s.length > 0).map((s) => resolve(s))
}

function report(warn: (msg: string) => void, issues: PackIssue[]): void {
  for (const i of issues) {
    const where = i.templateSlug ? `${i.pack}/${i.templateSlug}` : i.pack
    warn(`[tutorial-seed] pack ${where}: ${i.severity} ${i.code} — ${i.message}`)
  }
}

/**
 * Read, validate and de-duplicate operator-supplied tutorial packs.
 *
 * A pack is loaded WHOLE or not at all: any ERROR (bad manifest, bad template,
 * a slug that collides with a base template or an already-accepted pack) skips
 * the entire pack — it never partially seeds. Everything is reported through
 * `warn` (defaults to console.warn) so a misconfigured pack is loud, never
 * silent. Base tutorials and every clean pack still seed.
 */
export async function loadTutorialPacks(opts: {
  baseSlugs: ReadonlySet<string>
  env?: string
  warn?: (msg: string) => void
}): Promise<LoadedPack[]> {
  const warn = opts.warn ?? ((m: string) => console.warn(m))
  const env = opts.env ?? process.env.NODARO_TUTORIAL_PACKS
  const dirs = parsePackDirList(env)
  if (dirs.length === 0) return []

  const accepted: LoadedPack[] = []
  const seenSlugs = new Set<string>(opts.baseSlugs) // grows as packs are accepted

  for (const dir of dirs) {
    const label = dir
    // --- manifest ---
    let manifestRaw: unknown
    try {
      manifestRaw = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"))
    } catch (err) {
      warn(`[tutorial-seed] pack ${label}: error manifest_unreadable — ${(err as Error).message}`)
      continue
    }
    const parsed = parsePackManifest(manifestRaw, label)
    if (!parsed.manifest) {
      report(warn, parsed.issues)
      continue
    }
    const manifest = parsed.manifest

    // --- template files (exclude manifest.json) ---
    let entries: string[]
    try {
      entries = await readdir(dir)
    } catch (err) {
      warn(`[tutorial-seed] pack ${manifest.name}: error dir_unreadable — ${(err as Error).message}`)
      continue
    }
    const files = entries
      .filter((f) => f.endsWith(".json") && f !== "manifest.json")
      .sort((a, b) => a.localeCompare(b))

    const docs: TutorialTemplateDoc[] = []
    const issues: PackIssue[] = []
    let fatal = false

    // Local slug set to catch duplicates WITHIN this pack before touching the
    // cross-pack set, so a self-duplicating pack is skipped whole.
    const localSlugs = new Set<string>()

    for (const file of files) {
      let raw: unknown
      try {
        raw = JSON.parse(await readFile(join(dir, file), "utf8"))
      } catch (err) {
        issues.push({ pack: manifest.name, templateSlug: file, severity: "error", code: "doc_unreadable", message: (err as Error).message })
        fatal = true
        continue
      }
      const { doc, issues: docIssues } = validatePackDoc(raw, manifest)
      issues.push(...docIssues)
      if (docIssues.some((i) => i.severity === "error") || !doc) {
        fatal = true
        continue
      }
      if (localSlugs.has(doc.slug) || seenSlugs.has(doc.slug)) {
        issues.push({ pack: manifest.name, templateSlug: doc.slug, severity: "error", code: "slug_conflict", message: `slug "${doc.slug}" already used by the base set or another pack` })
        fatal = true
        continue
      }
      localSlugs.add(doc.slug)
      docs.push(doc)
    }

    report(warn, issues) // surface warnings + the errors that made it fatal
    if (fatal) {
      warn(`[tutorial-seed] pack ${manifest.name}: SKIPPED — validation errors above`)
      continue
    }
    if (docs.length === 0) {
      warn(`[tutorial-seed] pack ${manifest.name}: no template files found — skipping`)
      continue
    }

    for (const s of localSlugs) seenSlugs.add(s)
    // Pack-wide attribution: a doc without its own creatorDisplayName inherits
    // the manifest's (e.g. "Acme Team"). Base in-tree templates never take this
    // path, so they keep the seeder's default owner name.
    if (manifest.creatorDisplayName) {
      for (const d of docs) {
        if (d.creatorDisplayName == null) d.creatorDisplayName = manifest.creatorDisplayName
      }
    }
    accepted.push({
      name: manifest.name,
      dir,
      locale: manifest.locale,
      creatorDisplayName: manifest.creatorDisplayName,
      categories: manifest.categories,
      docs,
    })
  }

  return accepted
}
