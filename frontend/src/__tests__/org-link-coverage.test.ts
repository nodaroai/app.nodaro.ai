import { describe, expect, it } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

/**
 * Every organization link points at a route that exists.
 *
 * This is the invariant behind a whole class of bug that has already
 * happened twice tonight: a page ships, it links onward, and the target is
 * built two commits later — so between them a working action ends on the
 * NotFound handler, which reads to the person doing it as a FAILED action.
 * A join that appears to fail is the worst version, because the person who
 * hit it is the one who cannot report it.
 *
 * Checked from the source text rather than by rendering: the property is
 * structural (which literal paths exist in the route table), and rendering
 * every page in every state to collect its links would prove less while
 * breaking more often.
 */

const FRONTEND = join(__dirname, "..")
const ROUTER = readFileSync(join(FRONTEND, "router.tsx"), "utf8")

/** `to={`/org/${slug}/members`}` and `to="/org/new"` alike. */
function linkTargets(source: string): string[] {
  const targets: string[] = []
  for (const m of source.matchAll(/to=\{`([^`]+)`\}/g)) targets.push(m[1])
  for (const m of source.matchAll(/to="([^"]+)"/g)) targets.push(m[1])
  return targets
}

/** A template hole and a route parameter are the same thing to this test. */
function normalize(path: string): string {
  return path.replace(/\$\{[^}]*\}/g, ":x").replace(/:[A-Za-z][A-Za-z0-9]*/g, ":x")
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      if (name === "__tests__") continue
      walk(full, out)
    } else if (name.endsWith(".tsx")) {
      out.push(full)
    }
  }
  return out
}

const registered = new Set(
  [...ROUTER.matchAll(/path:\s*"([^"]+)"/g)].map((m) => normalize(m[1])),
)

const eeFiles = walk(join(FRONTEND, "ee"))

describe("organization links", () => {
  it("finds the routes the router declares", () => {
    expect(registered.has("/org/:x")).toBe(true)
    expect(registered.has("/w/:x")).toBe(true)
  })

  it("every /org and /w link in ee/ has a route", () => {
    const orphans: string[] = []
    for (const file of eeFiles) {
      const source = readFileSync(file, "utf8")
      for (const target of linkTargets(source)) {
        if (!/^\/(org|w)\b/.test(target)) continue
        const path = normalize(target.split("?")[0].replace(/\/$/, ""))
        if (!registered.has(path)) {
          orphans.push(`${file.slice(FRONTEND.length + 1)} -> ${target}`)
        }
      }
    }
    expect(orphans, "these links would land on the NotFound handler").toEqual([])
  })

  it("the two ways IN are reachable from the switcher", () => {
    // Someone with no organization yet has no list to switch between, and
    // the section that would otherwise disappear is the only place these
    // live.
    const switcher = readFileSync(join(FRONTEND, "ee", "components", "org", "org-switcher-section.tsx"), "utf8")
    expect(linkTargets(switcher)).toContain("/org/new")
    expect(linkTargets(switcher)).toContain("/join")
  })
})
