import { describe, it, expect } from "vitest"
import { composeLottieSlotOverrides, collectSlotExposedNodeIds } from "../lottie-slot-overrides"
import type { PresentationItem } from "@nodaro/shared"

/** A motion-graphics node carrying a lottie-graphic plan. */
function lottieNode(
  id: string,
  slots: Record<string, unknown>,
  slotValues: Record<string, unknown> = {},
) {
  return {
    id,
    type: "motion-graphics",
    data: {
      engine: "lottie",
      motionPlan: {
        planType: "lottie-graphic",
        lottie: { v: "5.7.0", layers: [] },
        slots,
        slotValues,
      },
    },
  }
}

const COLOR_SLOTS = {
  primaryColor: { p: { a: 0, k: [1, 0, 0, 1] } },
  nameText: { p: "Jane Doe" },
  barSize: { p: { a: 0, k: 40 } },
}

describe("composeLottieSlotOverrides", () => {
  it("converts a color hex slot value to a 0-1 RGBA array inside a full-plan motionPlan override", () => {
    const inputValues = { mg1: { "slot:primaryColor": "#00ff00" } }
    const out = composeLottieSlotOverrides(inputValues, [lottieNode("mg1", COLOR_SLOTS)])
    const plan = out.mg1.motionPlan as Record<string, unknown>
    expect(plan.planType).toBe("lottie-graphic")
    const slotValues = plan.slotValues as Record<string, unknown>
    expect(slotValues.primaryColor).toEqual([0, 1, 0, 1])
  })

  it("passes text slot values through untouched", () => {
    const inputValues = { mg1: { "slot:nameText": "Hello World" } }
    const out = composeLottieSlotOverrides(inputValues, [lottieNode("mg1", COLOR_SLOTS)])
    const slotValues = (out.mg1.motionPlan as Record<string, unknown>).slotValues as Record<string, unknown>
    expect(slotValues.nameText).toBe("Hello World")
  })

  it("coerces slider slot values to Number", () => {
    const inputValues = { mg1: { "slot:barSize": "72" } }
    const out = composeLottieSlotOverrides(inputValues, [lottieNode("mg1", COLOR_SLOTS)])
    const slotValues = (out.mg1.motionPlan as Record<string, unknown>).slotValues as Record<string, unknown>
    expect(slotValues.barSize).toBe(72)
    expect(typeof slotValues.barSize).toBe("number")
  })

  it("merges over the snapshot plan's existing slotValues (override wins, others retained)", () => {
    const node = lottieNode("mg1", COLOR_SLOTS, {
      primaryColor: [0.5, 0.5, 0.5, 1],
      nameText: "Original",
    })
    const inputValues = { mg1: { "slot:nameText": "New Name" } }
    const out = composeLottieSlotOverrides(inputValues, [node])
    const slotValues = (out.mg1.motionPlan as Record<string, unknown>).slotValues as Record<string, unknown>
    // Existing primaryColor retained, nameText overridden.
    expect(slotValues.primaryColor).toEqual([0.5, 0.5, 0.5, 1])
    expect(slotValues.nameText).toBe("New Name")
  })

  it("preserves non-slot keys alongside the composed motionPlan", () => {
    const inputValues = {
      mg1: { "slot:nameText": "Hi", text: "some prompt", someOther: 5 },
    }
    const out = composeLottieSlotOverrides(inputValues, [lottieNode("mg1", COLOR_SLOTS)])
    expect(out.mg1.text).toBe("some prompt")
    expect(out.mg1.someOther).toBe(5)
    expect((out.mg1.motionPlan as Record<string, unknown>).planType).toBe("lottie-graphic")
    // Slot keys are folded into motionPlan, not left as top-level keys.
    expect(out.mg1["slot:nameText"]).toBeUndefined()
  })

  it("passes a node with no slot keys through unchanged (no motionPlan injected)", () => {
    const inputValues = { tp1: { text: "just a prompt" } }
    const textNode = { id: "tp1", type: "text-prompt", data: {} }
    const out = composeLottieSlotOverrides(inputValues, [textNode])
    expect(out.tp1).toEqual({ text: "just a prompt" })
    expect(out.tp1.motionPlan).toBeUndefined()
  })

  it("leaves a non-lottie node's slot-looking keys untouched (no plan to fold into)", () => {
    // A node whose plan is the elements engine — slot keys cannot be composed.
    const elementsNode = {
      id: "mg2",
      type: "motion-graphics",
      data: { engine: "elements", motionPlan: { planType: "motion-graphics" } },
    }
    const inputValues = { mg2: { "slot:primaryColor": "#ff0000" } }
    const out = composeLottieSlotOverrides(inputValues, [elementsNode])
    // Passed through verbatim — no motionPlan override, slot key retained as-is.
    expect(out.mg2).toEqual({ "slot:primaryColor": "#ff0000" })
  })

  it("never mutates its inputs", () => {
    const node = lottieNode("mg1", COLOR_SLOTS, { primaryColor: [0.5, 0.5, 0.5, 1] })
    const inputValues = { mg1: { "slot:primaryColor": "#00ff00", text: "p" } }
    const inputValuesCopy = structuredClone(inputValues)
    const nodeCopy = structuredClone(node)
    composeLottieSlotOverrides(inputValues, [node])
    expect(inputValues).toEqual(inputValuesCopy)
    expect(node).toEqual(nodeCopy)
  })

  it("handles a node referenced in inputValues but absent from nodes (passthrough)", () => {
    const inputValues = { ghost: { "slot:primaryColor": "#00ff00" } }
    const out = composeLottieSlotOverrides(inputValues, [])
    expect(out.ghost).toEqual({ "slot:primaryColor": "#00ff00" })
  })

  // ---- Freeze-on-exposure (design F16) ----

  it("emits a passthrough full-plan override for an UNTOUCHED slot-exposed node (freeze signal)", () => {
    // The user touched nothing (no inputValues for mg1), but mg1 has slot fields
    // exposed by the app — so the freeze signal must still be emitted: the whole
    // snapshot plan as a motionPlan override, with its existing slotValues intact.
    const node = lottieNode("mg1", COLOR_SLOTS, { primaryColor: [0.2, 0.2, 0.2, 1] })
    const out = composeLottieSlotOverrides({}, [node], new Set(["mg1"]))
    const plan = out.mg1.motionPlan as Record<string, unknown>
    expect(plan.planType).toBe("lottie-graphic")
    // Existing slotValues carried through verbatim (the passthrough freeze plan).
    expect((plan.slotValues as Record<string, unknown>).primaryColor).toEqual([0.2, 0.2, 0.2, 1])
  })

  it("emits NOTHING for a non-exposed node the user never touched", () => {
    // mg1 is a lottie node but NOT slot-exposed and not in inputValues → no entry.
    const node = lottieNode("mg1", COLOR_SLOTS, { primaryColor: [0.2, 0.2, 0.2, 1] })
    const out = composeLottieSlotOverrides({}, [node], new Set())
    expect(out.mg1).toBeUndefined()
    expect(Object.keys(out)).toHaveLength(0)
  })

  it("still folds a TOUCHED value for a slot-exposed node (override wins over snapshot)", () => {
    const node = lottieNode("mg1", COLOR_SLOTS, { primaryColor: [0.2, 0.2, 0.2, 1] })
    const out = composeLottieSlotOverrides(
      { mg1: { "slot:primaryColor": "#00ff00" } },
      [node],
      new Set(["mg1"]),
    )
    const slotValues = (out.mg1.motionPlan as Record<string, unknown>).slotValues as Record<string, unknown>
    // Touched value overrides the snapshot's existing one.
    expect(slotValues.primaryColor).toEqual([0, 1, 0, 1])
  })

  it("does not inject a bogus plan for a slot-exposed node whose plan is NOT lottie-graphic", () => {
    // Defensive: an inconsistent published app exposing slots on a non-lottie
    // node. Degrade gracefully — no motionPlan override emitted.
    const elementsNode = {
      id: "mg2",
      type: "motion-graphics",
      data: { engine: "elements", motionPlan: { planType: "motion-graphics" } },
    }
    const out = composeLottieSlotOverrides({}, [elementsNode], new Set(["mg2"]))
    // No entry produced (empty values map passed through, no plan to freeze).
    expect((out.mg2 as Record<string, unknown> | undefined)?.motionPlan).toBeUndefined()
  })
})

describe("collectSlotExposedNodeIds", () => {
  it("collects node ids of field items whose field is a slot: key", () => {
    const items: PresentationItem[] = [
      { type: "node", nodeId: "n1" },
      { type: "field", id: "f1", nodeId: "mg1", field: "slot:primaryColor" },
      { type: "field", id: "f2", nodeId: "tp1", field: "text" }, // non-slot field
      { type: "field", id: "f3", nodeId: "mg1", field: "slot:nameText" }, // same node, 2nd slot
    ]
    const ids = collectSlotExposedNodeIds(items)
    expect(ids.has("mg1")).toBe(true)
    expect(ids.has("tp1")).toBe(false)
    expect(ids.has("n1")).toBe(false)
    expect(ids.size).toBe(1)
  })

  it("flattens groups to find nested slot fields", () => {
    const items: PresentationItem[] = [
      {
        type: "group",
        id: "g1",
        title: "Branding",
        items: [{ type: "field", id: "f1", nodeId: "mg2", field: "slot:logoColor" }],
      },
    ]
    const ids = collectSlotExposedNodeIds(items)
    expect(ids.has("mg2")).toBe(true)
  })

  it("returns an empty set for null/undefined/no-slot items", () => {
    expect(collectSlotExposedNodeIds(null).size).toBe(0)
    expect(collectSlotExposedNodeIds(undefined).size).toBe(0)
    expect(collectSlotExposedNodeIds([{ type: "node", nodeId: "n1" }]).size).toBe(0)
  })
})
