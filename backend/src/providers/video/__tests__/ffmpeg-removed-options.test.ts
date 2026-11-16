/**
 * NO FFMPEG OPTION THAT FFMPEG 9 REMOVED — a build-enforced invariant.
 *
 * ffmpeg 9.0 deleted a handful of long-deprecated command-line options. The
 * production image pins n8.1.2, which still accepts them (with a deprecation
 * warning), so nothing in production fails today. Any newer binary rejects the
 * WHOLE command with `Unrecognized option '<name>'` — a developer running the
 * backend against a Homebrew ffmpeg 9, a self-hoster on a current distro, and
 * production itself the day the pin is bumped.
 *
 * The failure is quiet where it matters most. Frame-matching helpers run inside
 * a best-effort try/catch: the smart-cut boundary search in combine-videos, for
 * one, keeps its fixed trims when the search throws, so the job still completes
 * and the only symptom is a visible jump at every cut point. That is how
 * `-vsync 0` surfaced (2026-09-15): a smart-cut combine came out with the
 * fixed-trims frame count although its PSNR matrix held a 42 dB twin at every
 * boundary, and the frame-extraction command it runs fails on ffmpeg 9.0.1.
 *
 * The list is the set difference of the option tables in `fftools/ffmpeg_opt.c`
 * between n8.1.2 and n9.0.1. Scanning for string literals is enough because
 * every ffmpeg invocation here passes an argv array, never a shell string.
 */
import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
/** Everything under backend/src — ffmpeg argv arrays live in providers,
 *  workers, routes and lib alike, so the scan is not scoped to one folder. */
const SRC_DIR = join(HERE, "..", "..", "..")

/** Option (without the leading dash) → what to write instead. */
const REMOVED_IN_FFMPEG_9: Readonly<Record<string, string>> = {
  vsync: "-fps_mode (0 → passthrough, 1 → cfr, 2 → vfr); available since ffmpeg 5.1",
  filter_script: "-/filter:<stream> <file> (the -/ file-loading prefix, ffmpeg 7.1+)",
  filter_complex_script: "-/filter_complex <file> (the -/ file-loading prefix, ffmpeg 7.1+)",
  qphist: "nothing — the option was removed without a replacement",
  top: "the setfield filter (-vf setfield=tff|bff|prog)",
  adrift_threshold: "the aresample filter's min_hard_comp option",
}

/**
 * Files that name a removed option only to RECOGNISE or REFUSE it, never to
 * pass it to ffmpeg, keyed `<file under src> <option>`, each with why. A
 * private plugin's run may still pass such an option (the pinned 8.1.2 takes
 * it), so the probe guard's checks name it in their notes; they recognise it
 * with a pattern, never an argv token. The exemption covers COMMENT lines
 * only: a hit in such a file's code is still a finding, and an entry that no
 * longer matches anything fails the test (the list stays exactly what is
 * needed).
 */
const RECOGNISES_ONLY: Readonly<Record<string, string>> = {
  "providers/video/link-arguments.ts filter_complex_script":
    "the rule that reads the file an option takes its value from names the older spelling it also reads (a plugin may still pass it)",
  "providers/video/plugin-run-guard.ts filter_complex_script":
    "a plugin run's checks name the option whose file they copy and check (a plugin may still pass it)",
  "providers/video/ffmpeg-reading-links.ts filter_complex_script":
    "the toolkit runners' note names an option whose file is checked before a plugin's run (a plugin may still pass it)",
}

/** A comment line: a JSDoc/block line (`*`) or a line comment. */
const isCommentLine = (text: string): boolean => /^\s*(?:\*|\/\/|\/\*)/.test(text)

/** A quoted argv token: the bare option or its per-stream form (`-vsync:v`). */
const OPTION_TOKEN = new RegExp(
  `["'\`]-(${Object.keys(REMOVED_IN_FFMPEG_9).join("|")})(?::[^"'\`\\s]*)?["'\`]`,
  "g",
)

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === "__tests__") continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) out.push(full)
  }
  return out
}

function findRemovedOptions(source: string): Array<{ line: number; option: string; comment: boolean }> {
  const hits: Array<{ line: number; option: string; comment: boolean }> = []
  source.split("\n").forEach((text, i) => {
    for (const match of text.matchAll(OPTION_TOKEN)) {
      hits.push({ line: i + 1, option: match[1]!, comment: isCommentLine(text) })
    }
  })
  return hits
}

describe("ffmpeg options removed in ffmpeg 9", () => {
  it("recognizes every removed option as an argv token, bare or per-stream", () => {
    // Guards the matcher itself: a regex that silently matches nothing would
    // turn the scan below into a test that can never fail.
    const sample = [
      `runFfmpeg(["-i", p, "-vsync", "0", out])`,
      `const args = ['-filter_script:v', file]`,
      "args.push(`-filter_complex_script`, file)",
      `["-qphist"]`, `["-top", "1"]`, `["-adrift_threshold", "0.1"]`,
    ].join("\n")
    expect(findRemovedOptions(sample).map((h) => h.option)).toEqual([
      "vsync", "filter_script", "filter_complex_script", "qphist", "top", "adrift_threshold",
    ])
  })

  it("does not flag the replacements or unrelated strings", () => {
    const sample = [
      `["-fps_mode", "passthrough"]`,
      `["-/filter_complex", file]`,
      `["-vf", "setfield=tff"]`,
      `const cls = "margin-top"`,
      `// -vsync 0 used to be here`,
    ].join("\n")
    expect(findRemovedOptions(sample)).toEqual([])
  })

  it("no backend source passes one to ffmpeg", () => {
    const files = walk(SRC_DIR)
    // The walk must actually reach the ffmpeg call sites, or the scan is vacuous.
    expect(files.some((f) => f.endsWith(join("providers", "video", "smart-loop-cut.ts")))).toBe(true)

    const offenders: string[] = []
    const exemptionsUsed = new Set<string>()
    for (const file of files) {
      const rel = relative(SRC_DIR, file).split("\\").join("/")
      for (const hit of findRemovedOptions(readFileSync(file, "utf8"))) {
        const key = `${rel} ${hit.option}`
        if (hit.comment && key in RECOGNISES_ONLY) {
          exemptionsUsed.add(key)
          continue
        }
        offenders.push(`${rel}:${hit.line} uses -${hit.option} — use ${REMOVED_IN_FFMPEG_9[hit.option]}`)
      }
    }
    expect(offenders).toEqual([])
    // An exemption nothing needs any more is removed, so the list stays exactly what is needed.
    expect(Object.keys(RECOGNISES_ONLY).filter((k) => !exemptionsUsed.has(k))).toEqual([])
  })

  it("an exemption covers a file's notes only: a removed option passed in its code is still a finding", () => {
    const hits = findRemovedOptions([
      " *   `-/vf`, `-/af`, `-filter_complex_script`): such a file is read first and",
      `  return runFfmpeg(["-filter_complex_script", graph, out])`,
    ].join("\n"))
    expect(hits.map((h) => [h.line, h.comment])).toEqual([[1, true], [2, false]])
  })
})
