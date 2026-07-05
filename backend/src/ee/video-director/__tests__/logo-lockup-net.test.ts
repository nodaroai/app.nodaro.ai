import { describe, it, expect } from "vitest"
import type { BrandTokens } from "@nodaro/shared"
import { ensureLogoLockupScene } from "../logo-lockup-net.js"

const brand = (image?: string): BrandTokens | undefined =>
  image ? { palette: { bg: "#000", text: "#fff", accent: "#0af" }, fonts: { heading: "Anton", body: "Inter" }, logo: { name: "Acme", tagline: "Go", image } } : undefined
const brief = (opts?: { withLockup?: boolean; noCues?: boolean }) => ({
  narration: { script: "hello world", cues: opts?.noCues ? [] : [{ id: "c1", text: "hello" }, { id: "c2", text: "world" }] },
  scenes: [
    { id: "s1", shots: [{ id: "sh1", reveals: [
      opts?.withLockup
        ? { id: "r1", revealAt: { kind: "cue", cueId: "c1", edge: "start" }, blueprint: { id: "logo-assemble-lockup", params: { brand: "Acme" } }, durationFrames: 120 }
        : { id: "r1", revealAt: { kind: "cue", cueId: "c1", edge: "start" }, blueprint: { id: "kinetic-type-beats", params: { lines: ["hi"] } }, durationFrames: 120 },
    ] }] },
  ],
})

describe("ensureLogoLockupScene", () => {
  it("is identity when no logo image", () => {
    const b = brief() as never
    expect(ensureLogoLockupScene(b, brand(undefined))).toBe(b)
  })
  it("is identity when a lockup already exists", () => {
    const b = brief({ withLockup: true }) as never
    expect(ensureLogoLockupScene(b, brand("https://cdn/x.png"))).toBe(b)
  })
  it("is identity when there are no cues to anchor to", () => {
    const b = brief({ noCues: true }) as never
    expect(ensureLogoLockupScene(b, brand("https://cdn/x.png"))).toBe(b)
  })
  it("appends a trailing lockup scene anchored to the last cue end", () => {
    const out = ensureLogoLockupScene(brief() as never, brand("https://cdn/x.png")) as never as { scenes: { shots: { reveals: { blueprint?: { id: string; params: Record<string, unknown> }; revealAt: { cueId?: string; edge?: string } }[] }[] }[] }
    expect(out.scenes).toHaveLength(2)
    const rev = out.scenes[1].shots[0].reveals[0]
    expect(rev.blueprint?.id).toBe("logo-assemble-lockup")
    expect(rev.blueprint?.params).toMatchObject({ brand: "Acme", tagline: "Go", accentColor: "#0af" })
    expect(rev.revealAt).toMatchObject({ cueId: "c2", edge: "end" })
  })
})
