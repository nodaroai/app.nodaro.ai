import { describe, it, expect } from "vitest"
import { effortTimeoutMs } from "../llm-effort-timeout.js"

describe("effortTimeoutMs", () => {
  it("leaves the client's default for default efforts", () => {
    for (const effort of [undefined, "none", "low", "medium"] as const) expect(effortTimeoutMs(effort)).toBeUndefined()
  })
  it("grows with the effort and stays under the engine's 300 s loopback ceiling", () => {
    expect(effortTimeoutMs("high")).toBe(240_000)
    expect(effortTimeoutMs("xhigh")).toBe(285_000)
    expect(effortTimeoutMs("max")).toBe(285_000)
    for (const effort of ["high", "xhigh", "max"] as const) expect(effortTimeoutMs(effort)!).toBeLessThan(300_000)
  })
})
