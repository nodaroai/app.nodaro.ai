// @test-reads-none reads only the option files it writes to its own temp dir
/**
 * A link named in a file an ffmpeg or ffprobe option reads its value from
 * (`-/filter_complex <file>`, `-/vf`, `-/af`, ffprobe's `-/i`, the older
 * `-filter_complex_script` / `-filter_script`) is held to the inline rule
 * (`link-arguments.ts`), and a value this check cannot read as a plain local
 * file is a refusal too. The real binaries' reads are in
 * `probe-guard.e2e.test.ts`.
 */
import { afterAll, describe, expect, it } from "vitest"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { namesALink, OPTION_FILE_MAX_BYTES, optionFileProblem, readsValueFromFile } from "../link-arguments.js"
import { isProbeGuardOption, optionFileLinkRefusal, unguardedProbeLinkRefusal } from "../probe-guard.js"

const dir = mkdtempSync(join(tmpdir(), "option-files-"))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
const file = (name: string, text: string) => {
  const path = join(dir, name)
  writeFileSync(path, text)
  return path
}

describe("the options that read their value from a file", () => {
  it("every -/ spelling and the two older script options; nothing else", () => {
    for (const option of ["-/filter_complex", "-/vf", "-/af", "-/filter:v", "-/i", "-/protocol_whitelist", "-filter_complex_script", "-filter_script", "-filter_script:v", "-filter_script:a:0"]) {
      expect(readsValueFromFile(option), option).toBe(true)
    }
    for (const arg of ["-filter_complex", "-vf", "-i", "-filter_complex_scripts", "-filter_scripting", "/tmp/a.txt", "-y", "fc.txt"]) {
      expect(readsValueFromFile(arg), arg).toBe(false)
    }
  })
})

describe("a file an option reads is held to the inline rule", () => {
  const link = "https://cdn.example/secret.mp4"

  it("a file that names a link, as written or in filter escaping, is refused; a clean one passes", () => {
    const plain = file("plain.txt", `movie=${link}[m];[0:v][m]overlay`)
    const escaped = file("escaped.txt", "[0:v]null[a];\nmovie='http\\://cdn.example\\:80/x.mp4'[m];[a][m]overlay")
    const clean = file("clean.txt", "movie=/tmp/local.mp4[m];[0:v][m]overlay")
    expect(namesALink("movie='http\\://cdn.example/x.mp4'")).toBe(true)
    expect(optionFileProblem(["-y", "-i", "/tmp/in.mp4", "-/filter_complex", plain, "/tmp/o.mp4"])).toEqual({ option: "-/filter_complex", problem: "names a link" })
    expect(optionFileProblem(["-filter_complex_script", escaped])).toEqual({ option: "-filter_complex_script", problem: "names a link" })
    expect(optionFileProblem(["-/vf", clean, "-/af", plain])).toEqual({ option: "-/af", problem: "names a link" })
    expect(optionFileProblem(["-y", "-/filter_complex", clean, "-filter_script:v", clean, "/tmp/o.mp4"])).toBeUndefined()
    // ffprobe's input read from a file.
    expect(optionFileProblem(["-v", "error", "-/i", file("input.txt", link)])).toEqual({ option: "-/i", problem: "names a link" })
  })

  it("a value that is not a plain local regular file is refused: missing, a directory, a FIFO, a protocol, too large, absent", () => {
    mkdirSync(join(dir, "a-dir"))
    const fifo = join(dir, "a-fifo")
    execFileSync("mkfifo", [fifo])
    const large = file("large.txt", "x".repeat(OPTION_FILE_MAX_BYTES + 1))
    const clean = file("clean2.txt", "hue=s=0")
    for (const value of [
      join(dir, "missing.txt"),
      join(dir, "a-dir"),
      fifo, // read, it would hold the check (and the run) forever
      `data:text/plain;base64,${Buffer.from(link).toString("base64")}`, // ffmpeg reads a value through its own I/O layer
      `file:${clean}`,
      "subfile,,start,0,end,7,:/etc/hosts",
      large,
    ]) {
      expect(optionFileProblem(["-/filter_complex", value]), value).toEqual({ option: "-/filter_complex", problem: "unreadable" })
    }
    expect(optionFileProblem(["-y", "-/vf"])).toEqual({ option: "-/vf", problem: "unreadable" })
  })

  it("the refusal is the link refusal, for the toolkit's ffmpeg runs and for every raw ffprobe run, guarded or not", () => {
    const named = file("named.txt", link)
    expect(optionFileLinkRefusal(["-/filter_complex", named], "ffmpeg")).toMatchObject({ reason: "link", message: expect.stringContaining("-/filter_complex reads names a link") })
    expect(optionFileLinkRefusal(["-/vf", join(dir, "nope")], "ffmpeg")).toMatchObject({ reason: "link", message: expect.stringContaining("not a readable local file") })
    expect(unguardedProbeLinkRefusal(["-v", "error", "-/i", named], undefined)).toMatchObject({ reason: "link" })
    // A guarded run's environment does not let a file name a link either (the guard places its options before the link it was given, never before one read from a file).
    expect(unguardedProbeLinkRefusal(["-/i", named], { http_proxy: "x" })).toMatchObject({ reason: "link" })
    // An escaped link is a link to a raw ffprobe run too (a lavfi movie= source).
    expect(unguardedProbeLinkRefusal(["-f", "lavfi", "-i", "movie='http\\://cdn.example/x.mp4'"], undefined)).toBeInstanceOf(Error)
    expect(unguardedProbeLinkRefusal(["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", "/tmp/in.mp4"], undefined)).toBeUndefined()
  })

  it("a guard option read from a file is the guard's own option", () => {
    expect(isProbeGuardOption("-/protocol_whitelist")).toBe(true)
    expect(isProbeGuardOption("-/format_whitelist")).toBe(true)
    expect(isProbeGuardOption("-protocol_whitelist")).toBe(true)
    expect(isProbeGuardOption("-/filter_complex")).toBe(false)
  })
})
