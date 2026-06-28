import { describe, expect, it } from "vitest"
import { BROWSE_DIALOG_Z, FILTER_SELECT_Z } from "../voice-browser"
import { STUDIO_MODAL_Z_VALUE } from "../../studio-shell/studio-modal-z"

// Bug (#3389-era): the "Browse Voices" dialog opened from a studio Voice page
// rendered BEHIND the studio modal and looked like nothing happened. The dialog
// + its filter Selects portal to <body>; the four entity studios render their
// opaque full-screen modal at STUDIO_MODAL_Z_VALUE. Creature/location/object
// shipped at z-[1000] while the dialog was only z-[110] — burying it (the
// original "voice dropdown does nothing" report). Now every studio shares
// STUDIO_MODAL_Z, so the real invariants are: the dialog clears the studio tier,
// and the filter menus clear the dialog.
//
// NOTE: the previous "FILTER_SELECT_Z < 1000" assertion was FALSE SAFETY — it
// could never have caught the z-[1000] studio modals it was supposed to protect
// against. It is intentionally replaced by the studio-tier assertion below.

const parseZ = (cls: string): number => {
  const m = cls.match(/z-\[(\d+)\]/)
  if (!m) throw new Error(`expected a z-[N] arbitrary value, got "${cls}"`)
  return Number(m[1])
}

describe("voice-browser z-index ordering", () => {
  it("the Browse Voices dialog clears every studio modal (STUDIO_MODAL_Z)", () => {
    expect(parseZ(BROWSE_DIALOG_Z)).toBeGreaterThan(STUDIO_MODAL_Z_VALUE)
  })

  it("filter dropdowns render ABOVE the Browse Voices dialog host", () => {
    expect(parseZ(FILTER_SELECT_Z)).toBeGreaterThan(parseZ(BROWSE_DIALOG_Z))
  })
})
