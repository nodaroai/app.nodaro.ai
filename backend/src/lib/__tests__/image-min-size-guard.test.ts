// @test-watches backend/src/**/*.ts
/**
 * No provider input is refused for a side under the model's minimum without
 * the enlarge being tried first (decided 2026-11-22).
 *
 * A model's minimum side is decided in ONE place, `planImageSize`
 * (lib/image-min-size.ts): it enlarges a smaller picture, shape kept, and
 * refuses only one no enlarged copy fits. The census:
 *
 * 1. Every backend file that compares a size against a stated minimum side
 *    (a `minDimension` / `minSide` field, or a sentence "requires images at
 *    least …px") calls `planImageSize`, or is listed in NOT_A_REFUSAL with
 *    the reason.
 * 2. The KIE input step (`ensureImageForProvider`) asks `planImageSize`
 *    before it refuses on `minDimension`, and enlarges with the plan.
 * 3. The lip-sync price check (OmniHuman 2.0's portrait) asks it before it
 *    refuses, and the run sends a portrait the plan enlarges through the KIE
 *    input step (one that fits goes as given).
 *
 * What a census cannot see: a minimum spelled some other way (`minWidth`,
 * a bare number). A new model's minimum goes on `minDimension` of its
 * `ImageConstraints` — the field `ensureImageForProvider` already plans.
 */
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { dirname, join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const BACKEND_SRC = join(HERE, "..", "..")

/** Files that compare against a minimum side without refusing on it. Paths from backend/src. */
const NOT_A_REFUSAL: Readonly<Record<string, string>> = {
  "lib/image-min-size.ts": "is the plan itself",
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__" || name === "dist") continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) sourceFiles(path, out)
    else if (/\.ts$/.test(name) && !/\.(test|spec)\.ts$/.test(name) && !name.endsWith(".d.ts")) out.push(path)
  }
  return out
}

/** A comparison with a minimum-side field on either side, or the old refusal sentence. */
const MIN_SIDE_COMPARISON =
  /(?<![=-])[<>]=?\s*[\w?.!]*\b(?:minDimension|minSide)\b|\b(?:minDimension|minSide)\b[\w?.!]*\s*[<>]=?(?!>)|requires images at least/

const rel = (path: string) => relative(BACKEND_SRC, path).split(sep).join("/")

describe("a minimum side is planned, never refused outright", () => {
  it("every file that compares a size against a minimum side calls planImageSize", () => {
    const offenders: string[] = []
    for (const path of sourceFiles(BACKEND_SRC)) {
      const src = readFileSync(path, "utf8")
      if (!MIN_SIDE_COMPARISON.test(src)) continue
      const name = rel(path)
      if (name in NOT_A_REFUSAL) continue
      if (!/\bplanImageSize\(/.test(src)) offenders.push(name)
    }
    expect(offenders, "compare against a minimum side through planImageSize (lib/image-min-size.ts)").toEqual([])
  })

  it("the KIE input step plans the minimum before any refusal on it, and resizes to the plan", () => {
    const src = readFileSync(join(BACKEND_SRC, "providers/kie/video.ts"), "utf8")
    const start = src.indexOf("async function prepareImageForProvider(")
    const end = src.indexOf("\n}\n", start)
    const body = src.slice(start, end)
    const plan = body.indexOf("planImageSize(")
    expect(plan).toBeGreaterThan(0)
    expect(body).toContain("minSide: constraints?.minDimension")
    // The first refusal that names the minimum comes after the plan.
    const firstRefusal = body.indexOf("requires images at least")
    expect(firstRefusal).toBeGreaterThan(plan)
    expect(body).toMatch(/resize\(enlargeTo\.width, enlargeTo\.height/)
  })

  it("the lip-sync check plans the portrait, and the run sends it through the KIE input step", () => {
    const check = readFileSync(join(BACKEND_SRC, "lib/lip-sync-inputs.ts"), "utf8")
    expect(check).toMatch(/planImageSize\(width, height, \{ minSide: image\.minSide/)
    expect(check).not.toMatch(/width < image\.minSide|height < image\.minSide/)
    const video = readFileSync(join(BACKEND_SRC, "providers/kie/video.ts"), "utf8")
    // Planned from its header; only an enlarge goes through the input step.
    expect(video).toMatch(/async function omnihumanPortraitUrl[\s\S]*?planImageSize\([\s\S]*?if \(plan\.kind !== "enlarge"\) return imageUrl[\s\S]*?ensureImageForProvider\(imageUrl, provider, \{[\s\S]*?minDimension: image\.minSide/)
    expect(video).toMatch(/rateModel \? await omnihumanPortraitUrl\(imageUrl, provider, rateModel\.rule\)/)
    expect(video).toMatch(/imageUrl: effectiveImageUrl,\s*\n\s*audioUrl: effectiveAudioUrl/)
  })

  it("the comparison pattern sees the shapes it is meant to", () => {
    for (const line of [
      "if (width < constraints.minDimension) throw x",
      "if (w < rule.image.minSide) return",
      "constraints?.minDimension > height",
      "`${p} requires images at least ${n}px`",
    ]) expect(MIN_SIDE_COMPARISON.test(line), line).toBe(true)
    for (const line of ["minDimension: 300,", "const minSide = constraints?.minDimension", "() => minSide"]) {
      expect(MIN_SIDE_COMPARISON.test(line), line).toBe(false)
    }
  })
})
