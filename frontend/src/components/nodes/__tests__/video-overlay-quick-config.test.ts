import { describe, it, expect } from "vitest"
import { NODE_QUICK_CONFIGS, readQuickConfigValue } from "../node-quick-configs"

const aspectControl = () => NODE_QUICK_CONFIGS()["video-overlay"]?.[0]

describe("Video Overlay quick strip — output aspect", () => {
  it("reads an unset aspect as Source", () => {
    const c = aspectControl()!
    expect(readQuickConfigValue(c, {})).toBe("source")
    expect(readQuickConfigValue(c, { outputAspect: "9:16" })).toBe("9:16")
  })

  it("Source clears the fit and the padding colour WITH the aspect; a ratio leaves them alone", () => {
    const c = aspectControl()!
    // toStrictEqual: the keys must be PRESENT (as undefined) so updateNodeData clears them.
    expect(c.write!("source")).toStrictEqual({ outputAspect: undefined, baseFit: undefined, backgroundColor: undefined })
    expect(c.write!("1:1")).toStrictEqual({ outputAspect: "1:1" })
  })
})
