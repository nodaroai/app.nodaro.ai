/**
 * PLUGIN_DAEMONS_URL carries the internal secret on every request the API
 * makes to the daemon host, so it must name a bare http(s) origin: no
 * credentials, and no path, query or fragment (a `?` in the base would
 * swallow the `/<daemon><path>` appended to it).
 */
import { describe, it, expect } from "vitest"
import { envSchema } from "../config.js"

const url = envSchema.shape.PLUGIN_DAEMONS_URL

describe("PLUGIN_DAEMONS_URL", () => {
  it.each([
    "http://127.0.0.1:9100",
    "http://127.0.0.1:9100/",
    "http://plugin-daemons.railway.internal:9100",
    "https://daemons.internal.example",
  ])("accepts the bare origin %s", (value) => {
    expect(url.safeParse(value).success).toBe(true)
  })

  it("defaults to loopback on 9100", () => {
    expect(url.parse(undefined)).toBe("http://127.0.0.1:9100")
  })

  it.each([
    ["another scheme", "ftp://127.0.0.1:9100"],
    ["credentials", "http://user:pass@127.0.0.1:9100"],
    ["a path", "http://127.0.0.1:9100/prefix"],
    ["a query", "http://127.0.0.1:9100/?x=1"],
    ["a fragment", "http://127.0.0.1:9100/#x"],
    ["not a URL", "127.0.0.1:9100"],
  ])("refuses %s", (_label, value) => {
    expect(url.safeParse(value).success).toBe(false)
  })
})
