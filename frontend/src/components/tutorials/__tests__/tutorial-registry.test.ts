import { describe, it, expect } from "vitest"
import { getTutorial, hasTutorial } from "../tutorial-registry"

// The registry is the ONLY gate on the guided view. The dashboard card, the
// route and the breadcrumb all ask it the same question, so a slug being
// registered is what turns the guided view on everywhere at once.
describe("tutorial registry", () => {
  it.each(["multi-reference-control", "welcome-demo", "person-node-basics", "suno-music-basics", "social-media-autopilot", "underwater-giants", "get-started-with-image-editing", "camera-coverage"])("recognises %s", (slug) => {
    expect(hasTutorial(slug)).toBe(true)
    expect(getTutorial(slug)).not.toBeNull()
  })

  // Every other flow tutorial must keep the ordinary snapshot preview — the
  // guided view is opt-in per template, not a new default for all of them.
  it.each(["welcome-demo-preview", "getting-started-with-the-person-node-be13eo", "no-parachute-az7n7l"])(
    "leaves %s without a guided view",
    (slug) => {
      expect(hasTutorial(slug)).toBe(false)
      expect(getTutorial(slug)).toBeNull()
    },
  )

  it("treats a missing slug as unregistered rather than throwing", () => {
    expect(hasTutorial(undefined)).toBe(false)
    expect(hasTutorial(null)).toBe(false)
    expect(hasTutorial("")).toBe(false)
    expect(getTutorial(undefined)).toBeNull()
  })

  // Guards against a prototype-pollution style lookup: `"toString" in REGISTRY`
  // is true via the prototype chain, and a plain `in` check would hand the card
  // a function where a definition belongs.
  it("does not treat inherited object properties as tutorials", () => {
    for (const key of ["toString", "constructor", "hasOwnProperty", "__proto__"]) {
      expect(hasTutorial(key)).toBe(false)
      expect(getTutorial(key)).toBeNull()
    }
  })

  it.each(["multi-reference-control", "welcome-demo", "person-node-basics", "suno-music-basics", "social-media-autopilot", "underwater-giants", "get-started-with-image-editing", "camera-coverage"])(
    "gives %s the pieces the shell needs",
    (slug) => {
      const def = getTutorial(slug)!
      expect(def.steps.length).toBeGreaterThan(0)
      expect(def.minutes).toBeGreaterThan(0)
      expect(def.Body).toBeTruthy()
      // Step numbers drive the focus state and the rail's "step N of M" counter,
      // so they must be a 1-based run with no gaps.
      expect(def.steps.map((s) => s.n)).toEqual(def.steps.map((_, i) => i + 1))
      for (const step of def.steps) {
        expect(step.title.trim()).not.toBe("")
        expect(step.sub.trim()).not.toBe("")
      }
    },
  )

  // Each tutorial is meant to look different; sharing a body component would
  // mean the second one silently inherited the first one's layout.
  it("gives each tutorial its own body", () => {
    expect(getTutorial("welcome-demo")!.Body).not.toBe(getTutorial("multi-reference-control")!.Body)
  })
})
