import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join, relative, resolve } from "node:path"

import { describe, expect, it } from "vitest"

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..")

/**
 * The package's ONE structural rule: nothing here may need a browser.
 *
 * The whole point of moving the studio's production codec into a package is
 * that the platform can run it — inside Fastify, in an MCP tool handler, in the
 * copilot's turn loop. Every edge below is one that compiles perfectly well in
 * a Vite bundle and throws (or silently resolves to `undefined`) on a server:
 *
 * - `react` / a component import — the studio's UI, which stays in the app.
 * - `import.meta.env` — Vite's build-time env, `undefined` under node.
 * - `@/…` — the studio app's bundler alias; there is no such alias here.
 * - `nodaro-client` / `supabase` — a browser-authenticated API client.
 * - `@nodaro/sdk` — the SDK CONSUMES this package; the reverse edge would
 *   invert the dependency direction and drag that client in behind it.
 * - `window` / `document` / `localStorage` — the drafts and clipboards that
 *   deliberately stayed in the app.
 *
 * A hit means a module came across that should not have, or that an edit
 * reintroduced the assumption the extraction exists to remove.
 */
const FORBIDDEN: ReadonlyArray<{ what: string; re: RegExp }> = [
  { what: 'an import from "react"', re: /from\s+"react(-dom)?[^"]*"/ },
  { what: "Vite's `import.meta.env`", re: /import\.meta\.env/ },
  { what: 'the studio app\'s "@/" alias', re: /from\s+"@\/[^"]*"/ },
  { what: "the browser API client", re: /from\s+"[^"]*nodaro-client[^"]*"/ },
  { what: "supabase", re: /from\s+"[^"]*supabase[^"]*"/ },
  { what: "@nodaro/sdk", re: /from\s+"@nodaro\/sdk[^"]*"/ },
  { what: "`window`", re: /(^|[^\w.])window\s*[.[]/ },
  { what: "`document.`", re: /(^|[^\w.])document\s*\./ },
  { what: "`localStorage` / `sessionStorage`", re: /\b(local|session)Storage\b/ },
]

/** Source lines only: a comment may name any of these while explaining itself. */
function codeLines(text: string): string[] {
  const out: string[] = []
  let inBlock = false
  for (const raw of text.split("\n")) {
    let line = raw
    if (inBlock) {
      const end = line.indexOf("*/")
      if (end === -1) continue
      line = line.slice(end + 2)
      inBlock = false
    }
    for (;;) {
      const start = line.indexOf("/*")
      if (start === -1) break
      const end = line.indexOf("*/", start + 2)
      if (end === -1) {
        line = line.slice(0, start)
        inBlock = true
        break
      }
      line = line.slice(0, start) + line.slice(end + 2)
    }
    const slash = line.indexOf("//")
    if (slash !== -1) line = line.slice(0, slash)
    if (line.trim()) out.push(line)
  }
  return out
}

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "fixtures") continue
      sources(full, out)
      continue
    }
    if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      out.push(full)
    }
  }
  return out
}

describe("the package is browser-free", () => {
  const files = sources(SRC)

  it("walks a non-trivial module tree", () => {
    expect(files.length).toBeGreaterThan(50)
  })

  it.each(FORBIDDEN)("no module reaches for $what", ({ re }) => {
    const hits: string[] = []
    for (const file of files) {
      for (const line of codeLines(readFileSync(file, "utf8"))) {
        if (re.test(line)) hits.push(`${relative(SRC, file)}: ${line.trim()}`)
      }
    }
    expect(hits).toEqual([])
  })
})
