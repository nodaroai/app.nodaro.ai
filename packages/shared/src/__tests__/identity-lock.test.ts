import { describe, it, expect } from "vitest"
import { buildIdentityLockLine } from "../identity-lock.js"
import type { ConnectedReference } from "../types.js"

const charRef = (over: Partial<ConnectedReference> = {}): ConnectedReference => ({
  id: "c", defaultName: "Victoria Hayes", source: "wired-character", url: "u", ...over,
})

describe("buildIdentityLockLine", () => {
  it("default-OFF for a character with no explicit flag → null", () => {
    expect(buildIdentityLockLine(charRef(), "reference image A")).toBeNull()
  })

  it("OFF when identityLock.enabled === false → null", () => {
    expect(buildIdentityLockLine(charRef({ identityLock: { enabled: false } }), "reference image A")).toBeNull()
  })

  it("custom text overrides the built-in, with the binding interpolated", () => {
    const ref = charRef({ identityLock: { enabled: true, text: "Keep {ref} pixel-perfect." } })
    expect(buildIdentityLockLine(ref, "reference image A")).toBe("Keep reference image A pixel-perfect.")
  })

  it("enabled:true with no text → built-in wording per source (character / face / creature)", () => {
    expect(buildIdentityLockLine(charRef({ identityLock: { enabled: true } }), "reference image A"))
      .toBe("Lock the exact identity of the person in reference image A — face, bone structure, skin tone, and all unique features.")
    expect(buildIdentityLockLine(
      { id: "f", defaultName: "Face", source: "wired-face", url: "u", identityLock: { enabled: true } },
      "reference image A",
    )).toBe("Lock the exact facial identity in reference image A — bone structure, features, and skin texture.")
    expect(buildIdentityLockLine(
      { id: "r", defaultName: "Rex", source: "wired-creature", url: "u", identityLock: { enabled: true } },
      "@image_2",
    )).toBe("Lock the exact identity of the creature in @image_2 — anatomy, markings, and all unique features.")
  })

  it("default-OFF for object/location/image → null", () => {
    expect(buildIdentityLockLine({ id: "o", defaultName: "Lamp", source: "wired-object", url: "u" }, "reference image A")).toBeNull()
    expect(buildIdentityLockLine({ id: "l", defaultName: "Library", source: "wired-location", url: "u" }, "reference image A")).toBeNull()
  })

  it("creature with enabled:true uses the creature wording", () => {
    const ref: ConnectedReference = { id: "r", defaultName: "Rex", source: "wired-creature", url: "u", identityLock: { enabled: true } }
    expect(buildIdentityLockLine(ref, "@image_2"))
      .toBe("Lock the exact identity of the creature in @image_2 — anatomy, markings, and all unique features.")
  })
})
