import { describe, it, expect } from "vitest"
import { lengthParts, positionOf } from "../review-time"

// Times in the inspector (§2.3 of the inspectors design): positions in m:ss,
// floored like a player, h:mm:ss past an hour; lengths under a minute in
// seconds to one decimal ("1.6 s").
describe("positionOf", () => {
  it("floors to m:ss, and h:mm:ss past an hour", () => {
    expect(positionOf(0)).toBe("0:00")
    expect(positionOf(751_999)).toBe("12:31")
    expect(positionOf(3_600_000 + 61_500)).toBe("1:01:01")
  })

  it("never goes negative", () => {
    expect(positionOf(-40)).toBe("0:00")
  })
})

describe("lengthParts", () => {
  it("gives seconds to one decimal under a minute", () => {
    expect(lengthParts(1_600)).toEqual({ seconds: 1.6 })
    expect(lengthParts(2_440)).toEqual({ seconds: 2.4 })
    expect(lengthParts(20_000)).toEqual({ seconds: 20 })
    expect(lengthParts(0)).toEqual({ seconds: 0 })
  })

  it("gives a clock from a minute on, including a length that rounds up to one", () => {
    expect(lengthParts(134_000)).toEqual({ clock: "2:14" })
    expect(lengthParts(59_960)).toEqual({ clock: "1:00" })
  })
})
