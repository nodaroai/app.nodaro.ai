import { describe, expect, it } from "vitest"
import { BROWSE_DIALOG_Z, FILTER_SELECT_Z } from "../voice-browser"

// Bug (#bugs session): the ElevenLabs filter dropdowns (gender/accent/age/
// language/use-case/tone) inside the "Browse Voices" dialog opened BEHIND it
// and couldn't be clicked. The filter Selects portal their content to <body>
// at shadcn's default z-50, while the host dialog was lifted to z-[110] (to
// clear the Character Studio modal at z-[100], see #3378). z-50 < z-[110] →
// the menu rendered under its own host. These constants pin the ordering so a
// future z-index bump on the dialog can't silently re-bury the menus.

const parseZ = (cls: string): number => {
  const m = cls.match(/z-\[(\d+)\]/)
  if (!m) throw new Error(`expected a z-[N] arbitrary value, got "${cls}"`)
  return Number(m[1])
}

describe("voice-browser z-index ordering", () => {
  it("filter dropdowns render ABOVE the Browse Voices dialog host", () => {
    expect(parseZ(FILTER_SELECT_Z)).toBeGreaterThan(parseZ(BROWSE_DIALOG_Z))
  })

  it("the Browse Voices dialog still clears the Character Studio modal (z-[100])", () => {
    expect(parseZ(BROWSE_DIALOG_Z)).toBeGreaterThan(100)
  })

  it("filter dropdowns stay below the toast / critical-overlay tier (z-[1000]+)", () => {
    expect(parseZ(FILTER_SELECT_Z)).toBeLessThan(1000)
  })
})
