// @test-units-by-name looks up Camera Switch's own declared inputs only
/**
 * Camera Switch's Speaker map input exists for Speaker Map's result alone, so
 * while Speaker Map is withheld from the viewer (the admin switch hides it from
 * users) the editor neither draws nor offers that input, and refuses a new wire
 * to it. Once the viewer can see Speaker Map, the input is offered as before.
 * A wire already on it keeps its pip and still runs (NODE_DEFINITIONS keeps it).
 */
import { describe, it, expect, beforeEach } from "vitest"
import { __resetSurfaceAvailabilityForTests } from "@/lib/surface-availability"
import { isTargetHandleWithheld, targetHandleShown } from "../target-handle-availability"
import { getTargetHandlesAccepting } from "../target-handle-registry"
import { isValidWorkflowConnection } from "../connection-validation"
import { getCompatibleNodes, resolveTargetHandle, type NodeOption } from "../node-compatibility"
import { NODE_DEFINITIONS } from "@/types/nodes"

const withheld = () => __resetSurfaceAvailabilityForTests({ nodes: ["speaker-map"], models: [] })
const available = () => __resetSurfaceAvailabilityForTests({ nodes: [], models: [] })

const JSON_SOURCE = "extract-field"
const typeOf = (id: string) => (id === "src" ? JSON_SOURCE : id === "cs" ? "camera-switch" : undefined)
const wireTo = (targetHandle: string) => ({ source: "src", sourceHandle: "json", target: "cs", targetHandle })
const speakerMapMatch = (m: { nodeType: string; handleId: string }) => m.nodeType === "camera-switch" && m.handleId === "speakerMap"
const options = [{ type: "camera-switch", label: "Camera Switch" }] as unknown as NodeOption[]

beforeEach(() => __resetSurfaceAvailabilityForTests(null))

describe("Camera Switch's Speaker map input follows Speaker Map's availability", () => {
  it("the input stays declared either way, so saved and agent-written wires resolve", () => {
    withheld()
    expect(NODE_DEFINITIONS.find((d) => d.type === "camera-switch")?.inputs).toContain("speakerMap")
  })

  describe("Speaker Map withheld from the viewer", () => {
    beforeEach(withheld)

    it("withholds the input, and only that input", () => {
      expect(isTargetHandleWithheld("camera-switch", "speakerMap")).toBe(true)
      expect(isTargetHandleWithheld("camera-switch", "edl")).toBe(false)
      expect(isTargetHandleWithheld("camera-switch", "transcript")).toBe(false)
      expect(isTargetHandleWithheld("apply-edl", "speakerMap")).toBe(false)
    })

    it("the node draws no pip — unless a wire already lands on it", () => {
      expect(targetHandleShown("cs", "camera-switch", "speakerMap", [])).toBe(false)
      expect(targetHandleShown("cs", "camera-switch", "speakerMap", [{ target: "other", targetHandle: "speakerMap" }])).toBe(false)
      expect(targetHandleShown("cs", "camera-switch", "speakerMap", [{ target: "cs", targetHandle: "speakerMap" }])).toBe(true)
      expect(targetHandleShown("cs", "camera-switch", "edl", [])).toBe(true)
    })

    it("no pip popover offers it as a candidate", () => {
      const matches = getTargetHandlesAccepting(JSON_SOURCE)
      expect(matches.some(speakerMapMatch)).toBe(false)
      expect(matches.some((m) => m.nodeType === "camera-switch" && m.handleId === "edl")).toBe(true)
    })

    it("the canvas refuses a new wire to it; the other inputs still connect", () => {
      expect(isValidWorkflowConnection(wireTo("speakerMap"), typeOf)).toBe(false)
      expect(isValidWorkflowConnection(wireTo("edl"), typeOf)).toBe(true)
    })

    it("the add-node popup still offers Camera Switch from a JSON output, wired to an input that is offered", () => {
      const offered = getCompatibleNodes("json", "source", options, JSON_SOURCE)
      expect(offered.direct.map((o) => o.type)).toContain("camera-switch")
      expect(resolveTargetHandle("camera-switch", "json", "source", JSON_SOURCE)).not.toBe("speakerMap")
    })
  })

  describe("before the viewer's availability answer has landed (or when it failed)", () => {
    // beforeEach leaves availability unloaded (null): hidden until loaded.
    it("withholds the input: no pip, no candidate, the wire is refused", () => {
      expect(isTargetHandleWithheld("camera-switch", "speakerMap")).toBe(true)
      expect(isTargetHandleWithheld("camera-switch", "edl")).toBe(false)
      expect(targetHandleShown("cs", "camera-switch", "speakerMap", [])).toBe(false)
      expect(getTargetHandlesAccepting(JSON_SOURCE).some(speakerMapMatch)).toBe(false)
      expect(isValidWorkflowConnection(wireTo("speakerMap"), typeOf)).toBe(false)
      expect(isValidWorkflowConnection(wireTo("edl"), typeOf)).toBe(true)
    })

    it("still draws the pip under a wire already on it", () => {
      expect(targetHandleShown("cs", "camera-switch", "speakerMap", [{ target: "cs", targetHandle: "speakerMap" }])).toBe(true)
    })

    it("offers the input once the answer lands with Speaker Map offered", () => {
      expect(isTargetHandleWithheld("camera-switch", "speakerMap")).toBe(true)
      available()
      expect(isTargetHandleWithheld("camera-switch", "speakerMap")).toBe(false)
    })
  })

  describe("Speaker Map available to the viewer (an admin, or once it is released)", () => {
    beforeEach(available)

    it("offers, draws and connects the input as before", () => {
      expect(isTargetHandleWithheld("camera-switch", "speakerMap")).toBe(false)
      expect(targetHandleShown("cs", "camera-switch", "speakerMap", [])).toBe(true)
      expect(getTargetHandlesAccepting(JSON_SOURCE).some(speakerMapMatch)).toBe(true)
      expect(isValidWorkflowConnection(wireTo("speakerMap"), typeOf)).toBe(true)
    })
  })
})
