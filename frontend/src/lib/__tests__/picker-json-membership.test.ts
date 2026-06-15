import { describe, it, expect } from "vitest"
import { TARGET_HANDLE_ACCEPTS } from "@/lib/target-handle-registry"
import { getHandleConnectionLimit } from "@/lib/handle-limits"

const PICKERS = ["person", "styling", "framing", "lens", "camera-format"] as const

describe("picker-json membership is set-driven", () => {
  it.each(PICKERS)("%s accepts describe-to-picker on picker-json (and rejects others)", (t) => {
    const pj = TARGET_HANDLE_ACCEPTS[t]?.find((e) => e.handleId === "picker-json")
    expect(pj).toBeTruthy()
    expect(pj!.accepts("describe-to-picker")).toBe(true)
    expect(pj!.accepts("generate-image")).toBe(false)
  })
  it.each(PICKERS)("%s caps the picker-json input at 1", (t) => {
    expect(getHandleConnectionLimit({ type: t, data: {} } as never, "picker-json")?.limit).toBe(1)
  })
})
