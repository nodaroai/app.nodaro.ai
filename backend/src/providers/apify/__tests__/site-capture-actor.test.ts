import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { SITE_CAPTURE_ACTOR } from "../site-capture-actor.js"

describe("SITE_CAPTURE_ACTOR — the spike's values are filled in", () => {
  it("pins an actor build", () => {
    expect(SITE_CAPTURE_ACTOR.build).not.toBe("SPIKE")
    expect(SITE_CAPTURE_ACTOR.build.trim().length).toBeGreaterThan(0)
  })
  it("runs at a real memory size", () => expect([1024, 2048, 4096, 8192]).toContain(SITE_CAPTURE_ACTOR.memoryMbytes))
  it("keeps the route's time budget: Apify aborts at 150 s, the call waits 170 s", () => {
    expect(SITE_CAPTURE_ACTOR.runTimeoutSecs).toBe(150)
    expect(SITE_CAPTURE_ACTOR.waitSecs).toBe(170)
  })
  it("option B sets the phone through the scraper's input; option B′ runs our own actor", () => {
    if (SITE_CAPTURE_ACTOR.option === "B") expect(Object.keys(SITE_CAPTURE_ACTOR.deviceInput).length).toBeGreaterThan(0)
    else expect(SITE_CAPTURE_ACTOR.apifyActorId.startsWith("apify/")).toBe(false)
  })
  it("never uses a residential proxy", () => expect(JSON.stringify(SITE_CAPTURE_ACTOR.proxyConfiguration)).not.toMatch(/residential/i))
})

describe("SITE_CAPTURE_ACTOR — the pinned build matches the actor source in this repo", () => {
  it("under option B′ the build is a build of actor.json's version", () => {
    if (SITE_CAPTURE_ACTOR.option !== "B-prime") return
    const actor = JSON.parse(
      readFileSync(new URL("../site-capture-actor-src/.actor/actor.json", import.meta.url), "utf8"),
    ) as { version: string }
    expect(SITE_CAPTURE_ACTOR.build.startsWith(`${actor.version}.`)).toBe(true)
  })
})
