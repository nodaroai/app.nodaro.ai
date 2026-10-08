/**
 * THE DESCRIPTOR IS JOB-ONLY (P3.2b round 3, decided 2026-10-08; the plan's
 * Privacy line): it is never persisted beyond the job, never in the output
 * artifact, never in a checkpoint, never used across episodes. Core's side of
 * that promise, pinned here:
 *
 *  - only the detector computes it, and the detector stores nothing (its one
 *    storage import is the URL check);
 *  - the toolkit lends the member as is: no cache or log wraps it;
 *  - the artifact gate drops it: a box that carries one through
 *    `normalizeSpeakerTracks` comes out without it.
 *
 * The plugin's linker pins the checkpoint half (its snapshot carries none).
 */
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { normalizeSpeakerTracks } from "@nodaro/shared"

const SRC = resolve(__dirname, "../../..")
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name !== "__tests__" && name !== "node_modules") out.push(...sourceFiles(p))
    } else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) out.push(p)
  }
  return out
}

describe("the face descriptor never outlives the job", () => {
  it("only the detector computes it", () => {
    const users = sourceFiles(SRC)
      .filter((f) => /from "[^"]*face-descriptor\.js"/.test(strip(readFileSync(f, "utf8"))))
      .map((f) => relative(SRC, f))
      .sort()
    expect(users).toEqual(["services/face-detect/detect-faces.ts"])
  })

  it("the detector stores nothing: its only storage import is the check that a URL is ours", () => {
    const src = strip(readFileSync(join(SRC, "services/face-detect/detect-faces.ts"), "utf8"))
    const storage = [...src.matchAll(/import \{([^}]*)\} from "[^"]*\/storage\.js"/g)].map((m) => m[1]!.trim())
    expect(storage).toEqual(["r2KeyFromOurUrl"])
    expect(src).not.toMatch(/\b(upload|putObject|writeFile|createWriteStream|cache|logger|console)\w*\(/i)
  })

  it("the toolkit lends the member unwrapped", () => {
    const src = strip(readFileSync(join(SRC, "lib/private-plugins/toolkit.ts"), "utf8"))
    expect(src).toMatch(/import \{ detectFaces \} from "\.\.\/\.\.\/services\/face-detect\/detect-faces\.js"/)
    const media = src.slice(src.indexOf("media: {"), src.indexOf("}", src.indexOf("media: {")))
    expect(media).toMatch(/^\s*detectFaces,$/m)
  })

  it("the artifact gate drops it: normalizeSpeakerTracks keeps no descriptor on any box", () => {
    const set = normalizeSpeakerTracks({
      version: 1,
      sampleFps: 2,
      detector: { id: "yunet:2023mar-dyn@test" },
      sources: [{
        sourceId: "wide",
        clock: "source",
        frame: { w: 960, h: 540 },
        sampledSpans: [{ startMs: 0, endMs: 2_000 }],
        tracks: [{
          id: "wide/t1",
          descriptor: { version: 1, luma: "AAAA", hist: "AAAA" },
          boxes: [
            { ms: 0, x: 0.4, y: 0.2, w: 0.1, h: 0.2, score: 0.9, descriptor: { version: 1, luma: "AAAA", hist: "AAAA" } },
            { ms: 500, x: 0.41, y: 0.2, w: 0.1, h: 0.2, score: 0.9, landmarks: [[0.43, 0.27]] },
          ],
        }],
      }],
    })
    const boxes = set.sources[0]!.tracks[0]!.boxes
    expect(boxes).toHaveLength(2)
    expect(JSON.stringify(set)).not.toMatch(/descriptor|luma|hist|landmarks/)
  })
})
