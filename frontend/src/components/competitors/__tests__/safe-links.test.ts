import { readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Everything the Competitors page shows of a post (its words, its author,
 * its link) comes from scraped social posts: anyone can write it. So the
 * page renders it as text only, and a link opens only when it is http(s) —
 * `socialPostLink` decides that.
 */
const DIR = resolve(__dirname, "..")
const sources = readdirSync(DIR)
  .filter((f) => /\.(ts|tsx)$/.test(f))
  .map((f) => ({ file: f, text: readFileSync(join(DIR, f), "utf8") }))

describe("the Competitors components", () => {
  it("never inject markup", () => {
    expect(sources.filter((s) => s.text.includes("dangerouslySetInnerHTML")).map((s) => s.file)).toEqual([])
  })

  it("link only to what socialPostLink allowed", () => {
    const bad = sources.flatMap((s) =>
      [...s.text.matchAll(/href=\{([^}]*)\}/g)]
        .map((m) => m[1]!.trim())
        .filter((expr) => !/^[A-Za-z_$][\w$]*$/.test(expr) || !new RegExp(`const ${expr} = socialPostLink\\(`).test(s.text))
        .map((expr) => `${s.file}: href={${expr}}`),
    )
    expect(bad).toEqual([])
  })
})
