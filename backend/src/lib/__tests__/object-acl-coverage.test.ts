/**
 * Every object write goes through withObjectAcl().
 *
 * `STORAGE_OBJECT_ACL` is empty by default, so on Cloud and on a
 * bucket-policy self-host this helper adds nothing at all — which is exactly
 * why a missed call site is invisible. It only matters on the stores the
 * option exists for (DigitalOcean Spaces and friends, which refuse
 * PutBucketPolicy to a bucket-scoped key), and there a missed site writes an
 * object nobody can read: a broken image in the app, long after the upload
 * reported success.
 *
 * There are seven write constructions today — one multipart Upload, four
 * PutObjectCommand, two CopyObjectCommand — across lib/storage.ts and three
 * upload routes. A literal repeated seven times is a literal that will be
 * repeated wrong on the eighth, so the invariant is enforced structurally
 * rather than by review.
 */
import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { config } from "../config.js"
import { withObjectAcl } from "../storage.js"

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../..")

/** Constructors that WRITE an object. Reads and bucket-level ops are not here. */
const WRITE_COMMANDS = ["PutObjectCommand", "CopyObjectCommand"] as const

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__" || entry === "node_modules") continue
      sourceFiles(full, acc)
    } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
      acc.push(full)
    }
  }
  return acc
}

interface Site { where: string; wrapped: boolean }

function writeSites(): Site[] {
  const sites: Site[] = []
  for (const file of sourceFiles(SRC)) {
    const rel = relative(SRC, file).split(sep).join("/")
    const src = readFileSync(file, "utf8")

    for (const cmd of WRITE_COMMANDS) {
      const re = new RegExp(`new ${cmd}\\(`, "g")
      for (let m = re.exec(src); m; m = re.exec(src)) {
        const line = src.slice(0, m.index).split("\n").length
        sites.push({
          where: `${rel}:${line} — new ${cmd}`,
          wrapped: src.startsWith("withObjectAcl(", m.index + m[0].length),
        })
      }
    }

    // The multipart uploader takes the same shape under a `params:` key.
    const up = /new Upload\(\{/g
    for (let m = up.exec(src); m; m = up.exec(src)) {
      const line = src.slice(0, m.index).split("\n").length
      const body = src.slice(m.index, m.index + 400)
      sites.push({
        where: `${rel}:${line} — new Upload`,
        wrapped: body.includes("params: withObjectAcl("),
      })
    }
  }
  return sites
}

describe("object ACL coverage", () => {
  it("routes every Put / Copy / multipart write through withObjectAcl()", () => {
    const unwrapped = writeSites().filter((s) => !s.wrapped).map((s) => s.where)
    expect(unwrapped).toEqual([])
  })

  it("actually found the write sites (a vacuous pass is not a pass)", () => {
    // Seven today. Locked as a floor, not an equality: adding an eighth write
    // is fine — the test above is what makes it wrap.
    expect(writeSites().length).toBeGreaterThanOrEqual(7)
  })

  it("adds nothing by default, so Cloud and bucket-policy self-host are unchanged", () => {
    expect(config.STORAGE_OBJECT_ACL).toBe("")
    const params = { Bucket: "b", Key: "k" }
    expect(withObjectAcl(params)).toEqual({ Bucket: "b", Key: "k" })
    expect("ACL" in withObjectAcl(params)).toBe(false)
  })

  it("stamps the configured ACL when one is set, without mutating the input", () => {
    const original = config.STORAGE_OBJECT_ACL
    try {
      ;(config as { STORAGE_OBJECT_ACL: string }).STORAGE_OBJECT_ACL = "public-read"
      const params = { Bucket: "b", Key: "k" }
      expect(withObjectAcl(params)).toEqual({ Bucket: "b", Key: "k", ACL: "public-read" })
      expect("ACL" in params).toBe(false)
    } finally {
      ;(config as { STORAGE_OBJECT_ACL: string }).STORAGE_OBJECT_ACL = original
    }
  })
})
