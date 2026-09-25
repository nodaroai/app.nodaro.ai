import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"

/**
 * Centring is physical. `left-1/2` with `-translate-x-1/2` puts an element in
 * the middle in BOTH directions; a logical inset with a physical shift does
 * not. Under dir="rtl" `start-[50%]` becomes `right: 50%` while `translate-x`
 * still pulls left, so the element lands a whole width left of centre — every
 * dialog in the Hebrew UI sat half off-screen with its buttons out of reach.
 * logical-direction-coverage exempts `left-1/2` for exactly this case; this
 * scan keeps the logical-inset-plus-physical-shift pair from coming back.
 */
const SRC = path.resolve(__dirname, "../..")
const LOGICAL_MIDDLE = /(?<=["'`\s])(?:[^\s"'`]*:)?(?:start|end)-(?:\[50%\]|1\/2)(?![\w/])/
const PHYSICAL_SHIFT = /(?<=["'`\s])(?:[^\s"'`]*:)?-?translate-x-/

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "__tests__") continue
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(entry.name)) out.push(p)
  }
  return out
}

describe("RTL centring", () => {
  it(
    "no element pairs a logical 50% inset with a physical horizontal shift",
    () => {
      const offenders: string[] = []
      for (const file of walk(SRC)) {
        const lines = fs.readFileSync(file, "utf8").split("\n")
        lines.forEach((line, i) => {
          if (LOGICAL_MIDDLE.test(line) && PHYSICAL_SHIFT.test(line)) {
            offenders.push(`${path.relative(SRC, file).split(path.sep).join("/")}:${i + 1}`)
          }
        })
      }
      expect(offenders, "centre with left-1/2 + -translate-x-1/2 (direction-neutral), not start-[50%] / start-1/2").toEqual([])
    },
    60_000,
  )

  it("the scan recognises the pair it forbids", () => {
    const line = `"fixed top-[50%] start-[50%] translate-x-[-50%]"`
    expect(LOGICAL_MIDDLE.test(line) && PHYSICAL_SHIFT.test(line)).toBe(true)
    const fixed = `"fixed top-[50%] left-1/2 translate-x-[-50%]"`
    expect(LOGICAL_MIDDLE.test(fixed)).toBe(false)
  })
})
