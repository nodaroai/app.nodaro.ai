// @vitest-environment node
import { describe, expect, it } from "vitest"
import { gaVisitIdsFromCookies } from "../ga-cookies"

const ID = "G-TEST1234"
const SESSION_COOKIE = "_ga_TEST1234"

describe("gaVisitIdsFromCookies", () => {
  it("reads the client id and the current (GS2) session id", () => {
    const cookies = `theme=dark; _ga=GA1.1.1234567890.1700000000; ${SESSION_COOKIE}=GS2.1.s1700000500$o12$g1$t1700000900$j0$l0$h0`
    expect(gaVisitIdsFromCookies(cookies, ID)).toEqual({ gaClientId: "1234567890.1700000000", gaSessionId: "1700000500" })
  })

  it("reads the older (GS1) session format and a client id set on another domain level", () => {
    const cookies = `_ga=GA1.2.987654321.1600000000; ${SESSION_COOKIE}=GS1.1.1700000500.12.1.1700000900.0.0.0`
    expect(gaVisitIdsFromCookies(cookies, ID)).toEqual({ gaClientId: "987654321.1600000000", gaSessionId: "1700000500" })
  })

  it("skips a stale duplicate (e.g. one holding `deleted`) and takes the value that parses", () => {
    const cookies = `${SESSION_COOKIE}=deleted; _ga=GA1.1.1234567890.1700000000; ${SESSION_COOKIE}=GS2.1.s1700000500$o1$g0$t1700000500`
    expect(gaVisitIdsFromCookies(cookies, ID).gaSessionId).toBe("1700000500")
  })

  it("decodes an encoded cookie value", () => {
    expect(gaVisitIdsFromCookies(`${SESSION_COOKIE}=GS2.1.s1700000500%24o1%24g0`, ID).gaSessionId).toBe("1700000500")
  })

  it("reads only this property's session cookie", () => {
    const cookies = `_ga_OTHER999=GS2.1.s1700000500$o1; _ga=GA1.1.1234567890.1700000000`
    expect(gaVisitIdsFromCookies(cookies, ID)).toEqual({ gaClientId: "1234567890.1700000000" })
  })

  it("returns nothing it cannot read, and nothing for a malformed measurement id", () => {
    expect(gaVisitIdsFromCookies("", ID)).toEqual({})
    expect(gaVisitIdsFromCookies("_ga=GA1.1.abc.def", ID)).toEqual({})
    expect(gaVisitIdsFromCookies("_ga=GA1.1.1234567890", ID)).toEqual({})
    expect(gaVisitIdsFromCookies(`${SESSION_COOKIE}=GS3.1.s1700000500`, ID)).toEqual({})
    expect(gaVisitIdsFromCookies(`${SESSION_COOKIE}=GS2.1.o1$g0`, ID)).toEqual({})
    expect(gaVisitIdsFromCookies("_ga=GA1.1.1234567890.1700000000", "UA-1-1")).toEqual({})
  })
})
