import { describe, it, expect } from "vitest"
import {
  PARAMETER_NODE_TYPES,
  getParameterValue,
} from "../parameter-node-value.js"

describe("PARAMETER_NODE_TYPES", () => {
  it("includes the existing parameter node types", () => {
    expect(PARAMETER_NODE_TYPES.has("framing")).toBe(true)
    expect(PARAMETER_NODE_TYPES.has("camera-motion")).toBe(true)
    expect(PARAMETER_NODE_TYPES.has("motion")).toBe(true)
    expect(PARAMETER_NODE_TYPES.has("tone")).toBe(true)
    expect(PARAMETER_NODE_TYPES.has("aspect-ratio")).toBe(true)
    expect(PARAMETER_NODE_TYPES.has("scene-count")).toBe(true)
    expect(PARAMETER_NODE_TYPES.has("duration")).toBe(true)
    expect(PARAMETER_NODE_TYPES.has("style-guide")).toBe(true)
  })
  it("does not include executable node types", () => {
    expect(PARAMETER_NODE_TYPES.has("image-to-video")).toBe(false)
    expect(PARAMETER_NODE_TYPES.has("generate-image")).toBe(false)
  })
})

describe("getParameterValue", () => {
  it("returns first set per-category framing id for framing nodes (multi-category)", () => {
    expect(getParameterValue({ shotSize: "close-up" }, "framing")).toBe("close-up")
    // Falls through to next category when shotSize is unset
    expect(getParameterValue({ angle: "low-angle" }, "framing")).toBe("low-angle")
    expect(getParameterValue({ vantage: "front-on" }, "framing")).toBe("front-on")
  })
  it("returns cameraMotion id for camera-motion nodes", () => {
    expect(getParameterValue({ cameraMotion: "orbit-right" }, "camera-motion")).toBe("orbit-right")
  })
  it("returns motion for motion nodes", () => {
    expect(getParameterValue({ motion: "moderate" }, "motion")).toBe("moderate")
  })
  it("returns tone for tone nodes", () => {
    expect(getParameterValue({ tone: "dramatic" }, "tone")).toBe("dramatic")
  })
  it("returns ratio for aspect-ratio nodes", () => {
    expect(getParameterValue({ ratio: "16:9" }, "aspect-ratio")).toBe("16:9")
  })
  it("returns count-as-string for scene-count nodes", () => {
    expect(getParameterValue({ count: 5 }, "scene-count")).toBe("5")
  })
  it("returns seconds-as-string for duration nodes", () => {
    expect(getParameterValue({ seconds: 8 }, "duration")).toBe("8")
  })
  it("returns text for text-prompt nodes", () => {
    expect(getParameterValue({ text: "a dog" }, "text-prompt")).toBe("a dog")
  })
  it("returns text for style-guide nodes", () => {
    expect(getParameterValue({ text: "photographic" }, "style-guide")).toBe("photographic")
  })
  it("returns undefined for unknown types", () => {
    expect(getParameterValue({ foo: "bar" }, "image-to-video")).toBeUndefined()
  })
  it("returns undefined for missing field", () => {
    expect(getParameterValue({}, "framing")).toBeUndefined()
  })
  it("trims string values", () => {
    expect(getParameterValue({ shotSize: "  close-up  " }, "framing")).toBe("close-up")
  })
})

describe("parameter-node-value — action-fx", () => {
  it("includes action-fx in PARAMETER_NODE_TYPES", () => {
    expect(PARAMETER_NODE_TYPES.has("action-fx")).toBe(true)
  })

  it("returns the single id for a single-string value", () => {
    expect(getParameterValue({ actionFx: "lightning-bolt" }, "action-fx")).toBe("lightning-bolt")
  })

  it("returns the first id for an array value", () => {
    expect(getParameterValue({ actionFx: ["explosion-large", "shockwave-ground"] }, "action-fx")).toBe("explosion-large")
  })

  it("returns undefined when actionFx is empty string", () => {
    expect(getParameterValue({ actionFx: "" }, "action-fx")).toBeUndefined()
  })

  it("returns undefined when actionFx is missing", () => {
    expect(getParameterValue({}, "action-fx")).toBeUndefined()
  })
})

describe("getParameterValue — transition", () => {
  it("returns the id for a single string value", () => {
    expect(getParameterValue({ transition: "cross-dissolve" }, "transition")).toBe("cross-dissolve")
  })

  it("returns the first id for an array value (multi-pick)", () => {
    expect(getParameterValue({ transition: ["smash-cut", "white-flash"] }, "transition"))
      .toBe("smash-cut")
  })

  it("returns undefined for empty string / empty array", () => {
    expect(getParameterValue({ transition: "" }, "transition")).toBeUndefined()
    expect(getParameterValue({ transition: [] }, "transition")).toBeUndefined()
  })

  it("transition is in PARAMETER_NODE_TYPES set", () => {
    expect(PARAMETER_NODE_TYPES.has("transition")).toBe(true)
  })
})

describe("getParameterValue — character-fx", () => {
  it("returns the id for a single string value", () => {
    expect(getParameterValue({ characterFx: "werewolf" }, "character-fx")).toBe("werewolf")
  })
  it("returns first id for an array value (multi-pick)", () => {
    expect(getParameterValue({ characterFx: ["werewolf", "fire-breathe"] }, "character-fx"))
      .toBe("werewolf")
  })
  it("returns undefined for empty string / empty array", () => {
    expect(getParameterValue({ characterFx: "" }, "character-fx")).toBeUndefined()
    expect(getParameterValue({ characterFx: [] }, "character-fx")).toBeUndefined()
  })
  it("character-fx is in PARAMETER_NODE_TYPES set", () => {
    expect(PARAMETER_NODE_TYPES.has("character-fx")).toBe(true)
  })
})

describe("parameter-node-value — furniture", () => {
  it("includes furniture in PARAMETER_NODE_TYPES set", () => {
    expect(PARAMETER_NODE_TYPES.has("furniture")).toBe(true)
  })

  it("getParameterValue returns the trimmed furniture id from data", () => {
    expect(getParameterValue({ furniture: "  sofa  " }, "furniture")).toBe("sofa")
  })

  it("getParameterValue returns undefined when furniture field is missing", () => {
    expect(getParameterValue({}, "furniture")).toBeUndefined()
  })
})
