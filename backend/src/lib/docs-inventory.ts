/**
 * Read-only walks over the public docs (docs/) shared by the docs parity tests
 * and the surface-completeness checker (scripts/check-surfaces.ts), so a test
 * and the checker never disagree about what counts as "documented".
 */
// @reads docs/**
import { readdirSync, statSync } from "node:fs"
import { basename, join, relative, sep } from "node:path"

/** Every `.md` under a directory, recursively; `skipReadme` leaves out README.md files. */
export function walkMarkdown(dir: string, opts: { skipReadme?: boolean } = {}): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    const s = statSync(p)
    if (s.isDirectory()) out.push(...walkMarkdown(p, opts))
    else if (s.isFile() && entry.endsWith(".md") && !(opts.skipReadme && entry === "README.md")) out.push(p)
  }
  return out
}

/**
 * The node doc pages: node type → its `docs/nodes/<any-folder>/<type>.md` path,
 * relative to the repo root. The folder is not pinned to the registry category
 * (the docs folders are finer-grained than the category enum).
 */
export function nodeDocPages(repoRoot: string): Map<string, string> {
  const pages = new Map<string, string>()
  for (const file of walkMarkdown(join(repoRoot, "docs/nodes"), { skipReadme: true })) {
    pages.set(basename(file, ".md"), relative(repoRoot, file).split(sep).join("/"))
  }
  return pages
}

/** Whether docs/nodes/README.md links a node's page (`/<type>.md`). */
export function readmeLinksNode(readme: string, type: string): boolean {
  return readme.includes(`/${type}.md`)
}

/** Every `nodaro <group> <sub>` written in a text: the `<sub>` words, with their 1-based lines. */
export function cliSubcommandRefs(text: string, group: string): Array<{ sub: string; line: number }> {
  const re = new RegExp(`nodaro ${group.replace(/[-]/g, "\\-")} ([a-z-]+)`, "g")
  return [...text.matchAll(re)].map((m) => ({ sub: m[1]!, line: text.slice(0, m.index).split("\n").length }))
}

/**
 * Every CLI invocation written in a text — `nodaro` followed by up to three
 * lower-case command words (flags, arguments and placeholders end it) — with
 * its 1-based line. A compact alternation on the same line,
 * `nodaro <group> show <id> | update <id> | delete <id>`, also names
 * `<group> update` and `<group> delete`. The caller matches the words against
 * real command paths, so a shell pipe (`| jq`) resolves to nothing.
 */
export function cliInvocations(text: string): Array<{ words: string[]; line: number }> {
  const out: Array<{ words: string[]; line: number }> = []
  for (const m of text.matchAll(/\bnodaro((?: [a-z][a-z0-9-]*){1,3})/g)) {
    const words = m[1]!.trim().split(" ")
    const line = text.slice(0, m.index).split("\n").length
    out.push({ words, line })
    const start = m.index! + m[0].length
    const eol = text.indexOf("\n", start)
    const rest = text.slice(start, eol === -1 ? undefined : eol)
    for (const alt of rest.matchAll(/\s\|\s+([a-z][a-z0-9-]*)/g)) out.push({ words: [words[0]!, alt[1]!], line })
  }
  return out
}
