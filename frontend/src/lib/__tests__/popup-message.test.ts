import { describe, it, expect } from "vitest"
import { isFromWindow, readLoginPopupSession } from "../popup-message"

const ORIGIN = "https://app.example.test"
/** What `window.open` returned. Only identity matters. */
const popup = { name: "the pop-up" }
const anotherWindow = { name: "another window" }

describe("isFromWindow", () => {
  it("holds for the pop-up's own message on the expected origin", () => {
    expect(isFromWindow({ data: null, origin: ORIGIN, source: popup }, popup, ORIGIN)).toBe(true)
  })

  it("fails for a message on the expected origin from another window", () => {
    expect(isFromWindow({ data: null, origin: ORIGIN, source: anotherWindow }, popup, ORIGIN)).toBe(false)
  })

  it("fails for the pop-up's window showing another origin", () => {
    expect(isFromWindow({ data: null, origin: "https://id-provider.example", source: popup }, popup, ORIGIN)).toBe(false)
  })

  it("fails with no pop-up, even for a message that has no source either", () => {
    // A blocked pop-up leaves `window.open` returning null; a synthetic event has a null source.
    expect(isFromWindow({ data: null, origin: ORIGIN, source: null }, null, ORIGIN)).toBe(false)
    expect(isFromWindow({ data: null, origin: ORIGIN, source: undefined }, undefined, ORIGIN)).toBe(false)
  })
})

describe("readLoginPopupSession (the sign-in pop-up's hand-back)", () => {
  // The wire shape /auth/callback posts, spelled out so a rename shows here.
  const handBack = { type: "nodaro:authComplete", access_token: "access-1", refresh_token: "refresh-1" }

  it("returns the session the pop-up sent", () => {
    expect(readLoginPopupSession({ data: handBack, origin: ORIGIN, source: popup }, popup, ORIGIN)).toEqual({
      accessToken: "access-1",
      refreshToken: "refresh-1",
    })
  })

  it("ignores the same hand-back from another window on this origin", () => {
    expect(readLoginPopupSession({ data: handBack, origin: ORIGIN, source: anotherWindow }, popup, ORIGIN)).toBeNull()
  })

  it("ignores it from another origin", () => {
    expect(readLoginPopupSession({ data: handBack, origin: "https://attacker.example", source: popup }, popup, ORIGIN)).toBeNull()
  })

  it("ignores another type, and a hand-back missing either token", () => {
    const from = (data: unknown) => readLoginPopupSession({ data, origin: ORIGIN, source: popup }, popup, ORIGIN)
    expect(from({ ...handBack, type: "nodaro:somethingElse" })).toBeNull()
    expect(from({ ...handBack, access_token: "" })).toBeNull()
    expect(from({ ...handBack, refresh_token: undefined })).toBeNull()
    expect(from({ ...handBack, refresh_token: 42 })).toBeNull()
    expect(from("nodaro:authComplete")).toBeNull()
    expect(from(null)).toBeNull()
  })
})
