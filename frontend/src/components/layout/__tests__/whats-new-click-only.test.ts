/**
 * The what's-new dialog must never open by itself.
 *
 * It used to auto-open once per release for cloud users. Arriving to work and
 * being handed a changelog you did not ask for is an annoyance, not a feature
 * (founder, 2026-08-20) — a new release may light the version label, and the
 * dialog opens only when someone clicks it.
 *
 * Source-parsed rather than rendered: the sidebar pulls in the router, auth,
 * and several query hooks, so a full render would test the mocks more than the
 * behavior. The invariant here is structural — "nothing except a click opens
 * this dialog" — and that is exactly what the source can answer. Same approach
 * as the other structural guards in this repo (cloud-only-nodes,
 * media-node-sizing).
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const source = readFileSync(join(__dirname, "..", "app-sidebar.tsx"), "utf8")

/** Body of every useEffect(...) in the file, crudely but sufficiently sliced. */
function effectBodies(text: string): string[] {
  const bodies: string[] = []
  let from = 0
  for (;;) {
    const start = text.indexOf("useEffect(", from)
    if (start === -1) break
    // Walk to the matching close paren of the useEffect call.
    let depth = 0
    let i = text.indexOf("(", start)
    for (; i < text.length; i++) {
      if (text[i] === "(") depth++
      else if (text[i] === ")") {
        depth--
        if (depth === 0) break
      }
    }
    bodies.push(text.slice(start, i))
    from = i
  }
  return bodies
}

describe("what's-new dialog — click-only", () => {
  it("no effect opens the dialog (an effect runs on load; that is the auto-open we removed)", () => {
    const opening = effectBodies(source).filter((body) => /setUpdateDialogOpen\(\s*true\s*\)/.test(body))
    expect(opening).toEqual([])
  })

  it("the only opener is a click handler", () => {
    const opens = source.match(/setUpdateDialogOpen\(\s*true\s*\)/g) ?? []
    expect(opens.length).toBeGreaterThan(0)
    // Every opener sits inside an onClick={...} block.
    const clickBlocks = source.match(/onClick=\{[\s\S]*?\n\s*\}\}/g) ?? []
    const opensInsideClicks = clickBlocks.reduce(
      (n, block) => n + (block.match(/setUpdateDialogOpen\(\s*true\s*\)/g) ?? []).length,
      0,
    )
    expect(opensInsideClicks).toBe(opens.length)
  })

  it("still marks the release read when opened, so the unread dot clears", () => {
    expect(source).toMatch(/markWhatsNewSeen\(\)/)
    expect(source).toMatch(/nodaro-whatsnew-seen/)
  })
})

// #869: the version label is clickable in every edition. It used to be gated
// on hasCredits() (a billing question) — self-host lost the affordance the
// moment it was up to date, while /v1/version had already fetched the notes.
describe("version indicator — edition-agnostic", () => {
  it("is not gated on hasCredits(); it shows whenever a release is known", () => {
    expect(source).not.toMatch(/whatsNewMode\s*=\s*hasCredits\(\)/)
    expect(source).toMatch(/const showVersionIndicator = Boolean\(updateInfo\?\.latest\)/)
  })

  it("the dialog mode is derived from the install's state, with a 'current' mode for an up-to-date self-host", () => {
    expect(source).toMatch(/updateAvailable\s*\?\s*"upgrade"\s*:\s*isCloud\(\)\s*\?\s*"whats-new"\s*:\s*"current"/)
  })
})
