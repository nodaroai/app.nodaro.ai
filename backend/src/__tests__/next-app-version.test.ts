/**
 * The version engine (the versioning spec in the
 * plan repo): bumps derive from conventional commits so no human has to
 * remember — package.json sat at 1.23.0 for six months while 5,882 commits
 * shipped. Pure-function coverage; the git plumbing is exercised by the
 * release workflow itself.
 */
import { describe, it, expect } from "vitest"
// The release script is plain .mjs by design (runs in CI with zero build);
// its shapes are declared in the sibling .d.mts.
import {
  classify,
  nextVersion,
  parseVersion,
  releaseNotes,
} from "../../scripts/next-app-version.mjs"

const c = (subject: string, body = "") => ({ subject, body })

describe("classify", () => {
  it("routes conventional subjects to their buckets", () => {
    const out = classify([
      c("feat(nodes): add sparkle node"),
      c("fix(worker): stop double refund"),
      c("chore: bump deps"),
      c("docs: update quickstart"),
      c("weird commit without a type"),
    ])
    expect(out.feats).toEqual(["add sparkle node"])
    expect(out.fixes).toEqual(["stop double refund"])
    expect(out.others).toHaveLength(3)
    expect(out.breaking).toBe(0)
  })

  it("detects breaking via the subject bang AND the body footer — permissive on purpose (a surprise-breaking minor harms self-hosters; an extra major just increments a number)", () => {
    const out = classify([
      c("feat(billing)!: re-denominate credits"),
      c("feat(nodes): innocuous", "long body\nBREAKING CHANGE: env var renamed"),
      c("feat(nodes): plural form", "BREAKING CHANGES (dev-only):\n- something"),
      c("fix: mentions breaking mid-sentence", "this avoids breaking the flow"),
    ])
    expect(out.breaking).toBe(3)
    expect(out.breakingSubjects).toHaveLength(3)
  })
})

describe("nextVersion", () => {
  const v = { major: 1, minor: 23, patch: 0 }
  it("breaking -> major, resetting minor+patch", () => {
    expect(nextVersion(v, { breaking: 1, feats: ["x"] })).toEqual({ major: 2, minor: 0, patch: 0 })
  })
  it("feat -> minor, resetting patch", () => {
    expect(nextVersion({ ...v, patch: 4 }, { breaking: 0, feats: ["x"] })).toEqual({ major: 1, minor: 24, patch: 0 })
  })
  it("fixes/chores only -> patch", () => {
    expect(nextVersion(v, { breaking: 0, feats: [] })).toEqual({ major: 1, minor: 23, patch: 1 })
  })
})

describe("parseVersion", () => {
  it("round-trips a release tag and rejects anything else (npm package tags share the repo)", () => {
    expect(parseVersion("v1.23.0")).toEqual({ major: 1, minor: 23, patch: 0 })
    expect(() => parseVersion("@nodaro/sdk@1.17.0")).toThrow(/not a vX\.Y\.Z tag/)
    expect(() => parseVersion("v1.23")).toThrow()
  })
})

describe("releaseNotes", () => {
  it("caps each section and counts the overflow — a six-month bootstrap release must not blow the GitHub body limit", () => {
    const feats = Array.from({ length: 75 }, (_, i) => `feature ${i}`)
    const notes = releaseNotes("v1.23.0", "v1.24.0", {
      breaking: 0,
      breakingSubjects: [],
      feats,
      fixes: ["one fix"],
      others: [],
    })
    expect(notes).toContain("75 features, 1 fixes")
    expect(notes).toContain("- feature 59")
    expect(notes).not.toContain("- feature 60")
    expect(notes).toContain("…and 15 more")
  })

  it("a breaking release warns up top and lists the breaking subjects first", () => {
    const notes = releaseNotes("v1.23.0", "v2.0.0", {
      breaking: 1,
      breakingSubjects: ["feat(billing)!: re-denominate credits"],
      feats: ["something"],
      fixes: [],
      others: [],
    })
    expect(notes).toContain("MAJOR release")
    expect(notes.indexOf("Breaking changes")).toBeLessThan(notes.indexOf("## Features"))
  })
})
