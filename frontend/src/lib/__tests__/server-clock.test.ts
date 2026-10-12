import { afterEach, describe, expect, it } from "vitest"
import { noteServerDate, resetServerClock, serverNowIso } from "../server-clock"

/**
 * A time the editor stamps beside a result is compared with run and job times
 * the server wrote, so it is read on the server's clock: each API answer's
 * `Date` header sets how far this browser's clock is off.
 */
afterEach(() => resetServerClock())

describe("the server's clock, as the browser reads it", () => {
  it("before any answer was read, the browser's own clock stands in", () => {
    expect(serverNowIso(Date.parse("2026-10-05T10:00:00.000Z"))).toBe("2026-10-05T10:00:00.000Z")
  })

  it("an answer's Date header sets the offset: a browser two minutes fast stamps the server's time", () => {
    // The header is whole seconds: its time is read at the middle of the second it names.
    noteServerDate("Mon, 05 Oct 2026 10:00:00 GMT", Date.parse("2026-10-05T10:02:00.500Z"))
    expect(serverNowIso(Date.parse("2026-10-05T10:02:10.500Z"))).toBe("2026-10-05T10:00:10.500Z")
  })

  it("a missing or unreadable header changes nothing", () => {
    noteServerDate("Mon, 05 Oct 2026 10:00:00 GMT", Date.parse("2026-10-05T10:02:00.500Z"))
    noteServerDate(null)
    noteServerDate("not a date")
    expect(serverNowIso(Date.parse("2026-10-05T10:02:00.500Z"))).toBe("2026-10-05T10:00:00.500Z")
  })
})
