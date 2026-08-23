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
 * repeated wrong on the eighth, so the invariant is enforced structurally.
 *
 * Structurally means the AST, not a regex: a text scan matching
 * `new PutObjectCommand(` misses `new PutObjectCommand(params)` and a
 * reformatted `new Upload(\n  {`, and a fixed-size window for `params:`
 * reds the build on correct-but-long code. Both failure directions are
 * silent-coverage bugs in a guard whose whole job is to catch the invisible.
 */
import { describe, it, expect } from "vitest"
import ts from "typescript"
import { SCAN_TIMEOUT_MS, eachSourceFile, lineOf, walk } from "./source-scan.js"
import { config } from "../config.js"
import { withObjectAcl } from "../storage.js"

/** Constructors that WRITE an object. Reads and bucket-level ops are not here. */
const WRITE_COMMANDS = new Set(["PutObjectCommand", "CopyObjectCommand"])
/** The multipart uploader takes the same params under a `params:` key. */
const UPLOADER = "Upload"

interface Site { where: string; wrapped: boolean }

function isWithObjectAcl(node: ts.Node | undefined): boolean {
  return (
    !!node &&
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "withObjectAcl"
  )
}

/** The `params:` property of an object-literal argument, if present. */
function paramsInitializer(arg: ts.Node | undefined): ts.Node | undefined {
  if (!arg || !ts.isObjectLiteralExpression(arg)) return undefined
  for (const prop of arg.properties) {
    if (
      ts.isPropertyAssignment(prop) &&
      ts.isIdentifier(prop.name) &&
      prop.name.text === "params"
    ) {
      return prop.initializer
    }
  }
  return undefined
}

function writeSites(): Site[] {
  const sites: Site[] = []
  eachSourceFile([...WRITE_COMMANDS, UPLOADER], (sf, rel) => {
    walk(sf, (n) => {
      if (!ts.isNewExpression(n) || !ts.isIdentifier(n.expression)) return
      const name = n.expression.text
      const arg = n.arguments?.[0]

      if (WRITE_COMMANDS.has(name)) {
        sites.push({
          where: `${rel}:${lineOf(sf, n)} — new ${name}`,
          wrapped: isWithObjectAcl(arg),
        })
      } else if (name === UPLOADER) {
        sites.push({
          where: `${rel}:${lineOf(sf, n)} — new ${UPLOADER}`,
          wrapped: isWithObjectAcl(paramsInitializer(arg)),
        })
      }
    })
  })
  return sites
}

// Walked once, lazily: at module scope this would run during collection,
// where vitest's per-test timeout does not apply and a slow runner surfaces
// as an opaque collection failure instead of a named slow test.
let cached: Site[] | null = null
const sites = (): Site[] => (cached ??= writeSites())

describe("object ACL coverage", () => {
  it("routes every Put / Copy / multipart write through withObjectAcl()", () => {
    expect(sites().filter((s) => !s.wrapped).map((s) => s.where)).toEqual([])
  }, SCAN_TIMEOUT_MS)

  it("actually found the write sites (a vacuous pass is not a pass)", () => {
    // Seven today. A floor, not an equality: adding an eighth write is fine —
    // the check above is what makes it wrap.
    expect(sites().length).toBeGreaterThanOrEqual(7)
  }, SCAN_TIMEOUT_MS)

  it("recognises the shapes a text scan would miss", () => {
    const scan = (src: string) => {
      const sf = ts.createSourceFile("t.ts", src, ts.ScriptTarget.Latest, true)
      const out: boolean[] = []
      walk(sf, (n) => {
        if (!ts.isNewExpression(n) || !ts.isIdentifier(n.expression)) return
        if (WRITE_COMMANDS.has(n.expression.text)) out.push(isWithObjectAcl(n.arguments?.[0]))
        else if (n.expression.text === UPLOADER) {
          out.push(isWithObjectAcl(paramsInitializer(n.arguments?.[0])))
        }
      })
      return out
    }

    // A hoisted params object is a real, unwrapped site — must be caught.
    expect(scan("const p = {Bucket: b}; new PutObjectCommand(p)")).toEqual([false])
    // Reformatting must not hide a multipart upload from the scan.
    expect(scan("new Upload(\n  {\n    client: s3,\n    params: {Bucket: b},\n  },\n)")).toEqual([false])
    expect(scan("new Upload(\n  {\n    client: s3,\n    params: withObjectAcl({Bucket: b}),\n  },\n)")).toEqual([true])
    // ...and correct code must not be flagged however long the preamble is.
    expect(scan(`new Upload({client: s3, /* ${"x".repeat(600)} */ params: withObjectAcl({Bucket: b})})`)).toEqual([true])
    expect(scan("new PutObjectCommand(withObjectAcl({Bucket: b}))")).toEqual([true])
    // Reads are not write sites.
    expect(scan("new GetObjectCommand({Bucket: b})")).toEqual([])
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
