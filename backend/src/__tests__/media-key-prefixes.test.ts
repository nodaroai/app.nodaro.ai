/**
 * Produced media lives under exactly three prefixes — `images/`, `videos/`,
 * `audios/` — and every writer in this repo builds its key through
 * `mediaObjectKey` in lib/storage.ts. Nine call sites used to hand
 * `uploadBufferToR2` a literal `audio/…` key and split the audio store across
 * two folders (#754): nothing broke (deletion is DB-keyed), but the next
 * prefix-scoped lifecycle rule or bucket audit would have silently missed every
 * speech / voice-changer / revoice file. This scan makes a twelfth hand-written
 * prefix a build failure.
 *
 * Structural on purpose (source scan, not a runtime probe): the drift is a
 * string literal at a call site, and that is where it has to be caught.
 *
 * Scope and known gaps, so nobody over-trusts it: comments are stripped before
 * scanning (prose may legitimately quote a bad key); only literals that END in
 * a media extension count (content types — `audio/mpeg`, `image/${format}` —
 * share the prefix but never carry one); a key built by concatenation
 * (`"audio/" + id`) or a bare `"audio/"` prefix is NOT caught; `backend/scripts/`
 * (operator one-offs) and the private cloud-plugins package (reaches the
 * builder as `tk.storage.mediaObjectKey`) are out of reach.
 */
import { describe, expect, it } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const SRC = join(__dirname, "..")

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__" || entry === "__characterization__" || entry === "node_modules") continue
      walk(full, out)
    } else if (full.endsWith(".ts") && !full.endsWith(".test.ts") && !full.endsWith(".d.ts")) {
      out.push(full)
    }
  }
  return out
}

/** Drop block comments and full-line `//` comments (a trailing `// …` stays — a rare false positive beats eating `https://` inside strings). */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/[^\n]*/gm, "")
}

/** A literal starting with a SINGULAR media prefix, in any quoting. */
const SINGULAR_PREFIX_LITERAL = /(["'`])(audio|video|image)\/[^"'`\n]*\1/g
/** …that is an object KEY: it ends in a media file extension. */
const MEDIA_EXT = /\.(mp3|mp4|wav|png|jpg|jpeg|webp|gif|avif|m4a|aac|ogg|opus|flac|mov|mkv|webm)\b/

describe("produced-media object keys (#754)", () => {
  it("no source file spells a singular `audio/` / `video/` / `image/` object key by hand", () => {
    const offenders: string[] = []
    for (const file of walk(SRC)) {
      const text = stripComments(readFileSync(file, "utf8"))
      for (const m of text.matchAll(SINGULAR_PREFIX_LITERAL)) {
        const literal = m[0]
        if (!MEDIA_EXT.test(literal)) continue
        offenders.push(`${relative(SRC, file)}: ${literal}`)
      }
    }
    expect(offenders, "build media keys with mediaObjectKey(id, type, ext) (or tmpObjectKey for provider-input scratch) — see lib/storage.ts").toEqual([])
  })
})
