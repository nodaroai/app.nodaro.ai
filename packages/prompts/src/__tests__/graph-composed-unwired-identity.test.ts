import { describe, it, expect } from "vitest"

import { getParameterPromptHint } from "../parameter-prompt-hint.js"
import { getPickerCatalog, type PickerOption } from "../picker-catalogs.js"
import { composeTransitionHintFromConnections } from "../transitions.js"
import { composeCharacterFxHintFromConnections } from "../character-fx.js"
import type { HintEdgeLike, HintGraphContext, HintNodeLike } from "@nodaro/shared/types"

/**
 * THE BOUND ON "compose transition and character-fx from the graph on every
 * path", as a proof rather than a claim.
 *
 * Transition and character-fx joined `EXECUTION_GRAPH_COMPOSED_PARAMETER_TYPES`
 * (@nodaro/shared) and `LABEL_REF_GRAPH_COMPOSED_PARAMETER_TYPES` (backend
 * `services/workflow-engine/label-ref-hint-context.ts`), so every executor now
 * hands them the graph. That deliberately changes the prompt of a workflow that
 * WIRES them — signed off, and the new text is the text the picker's own
 * injection preview has always shown.
 *
 * What was signed off with it is the BOUND: a picker with nothing wired to its
 * own composing handles (`startState` / `endState` for transition, `target` for
 * character-fx) must emit BYTE-IDENTICAL text with and without the graph, so a
 * workflow that wires nothing cannot move at all. This file walks every entry
 * of both catalogs, in both hint modes, under two unwired graph shapes, and
 * asserts that equality — then proves it is not vacuous with wired positive
 * controls that MUST differ.
 *
 * Why two unwired shapes: "unwired" in a real workflow does not mean an
 * isolated node. The picker is normally wired INTO a consumer (an outgoing
 * `cinematography` edge) while nothing feeds its own handles — the walker in
 * `resolveParameterHint` only ever looks at edges whose TARGET is the picker,
 * and this pins that.
 */

const MODES = ["full", "compact"] as const

/** The two pickers this change admitted, with the data field each reads. */
const SUBJECTS = [
  { type: "transition", valueField: "transition" },
  { type: "character-fx", valueField: "characterFx" },
] as const

function optionsFor(type: string): readonly PickerOption[] {
  const catalog = getPickerCatalog(type)
  if (!catalog?.options?.length) throw new Error(`no registered picker catalog options for ${type}`)
  return catalog.options
}

function pickerNode(type: string, valueField: string, id: string, mode: string): HintNodeLike {
  return { id: "picker", type, data: { [valueField]: id, hintMode: mode } }
}

/** Nothing at all around the picker. */
function isolated(node: HintNodeLike): HintGraphContext {
  return { nodes: [node], edges: [] }
}

/** The realistic unwired shape: the picker FEEDS a consumer, but nothing feeds it. */
function wiredIntoConsumer(node: HintNodeLike): HintGraphContext {
  const consumer: HintNodeLike = { id: "consumer", type: "generate-video", data: { prompt: "a man walks forward" } }
  const edges: HintEdgeLike[] = [
    { source: node.id, target: consumer.id, sourceHandle: null, targetHandle: "cinematography" },
  ]
  return { nodes: [node, consumer], edges }
}

const UNWIRED_SHAPES = [
  { name: "isolated (no edges at all)", build: isolated },
  { name: "wired INTO a consumer, nothing wired into it", build: wiredIntoConsumer },
] as const

describe("unwired transition / character-fx pickers are byte-identical with and without the graph", () => {
  for (const { type, valueField } of SUBJECTS) {
    for (const { name, build } of UNWIRED_SHAPES) {
      it(`${type}: every catalog entry × both hint modes, ${name}`, () => {
        const options = optionsFor(type)
        const differences: string[] = []
        let compared = 0

        for (const option of options) {
          for (const mode of MODES) {
            const node = pickerNode(type, valueField, option.id, mode)
            const withoutGraph = getParameterPromptHint(node)
            const withGraph = getParameterPromptHint(node, build(node))
            compared += 1
            if (withGraph !== withoutGraph) {
              differences.push(`${type}/${option.id}/${mode}: ${JSON.stringify(withoutGraph)} -> ${JSON.stringify(withGraph)}`)
            }
          }
        }

        // Non-vacuity of the WALK itself: a catalog that somehow arrived empty
        // would pass a zero-difference assertion trivially.
        expect(compared).toBe(options.length * MODES.length)
        expect(compared).toBeGreaterThan(20)
        expect(differences).toEqual([])
      })
    }
  }

  it("the catalogs really do carry injecting entries (the comparison is over real text, not all empty strings)", () => {
    // `auto` / `none` inject "" by design and are legitimately compared; this
    // asserts they are not ALL of it, so the identity above is meaningful.
    for (const { type, valueField } of SUBJECTS) {
      const injecting = optionsFor(type).filter(
        (o) => getParameterPromptHint(pickerNode(type, valueField, o.id, "full")).trim().length > 0,
      )
      expect(injecting.length, type).toBeGreaterThan(20)
    }
  })
})

describe("positive control — a WIRED picker must differ (or the bound above proves nothing)", () => {
  /** A tone node: free text, so its fragment is identical in both hint modes,
   *  which keeps the control honest without re-deriving inherited-mode text. */
  const tone = (id: string, text: string): HintNodeLike => ({ id, type: "tone", data: { tone: text } })

  it("transition: a startState + endState wire changes the text, in both modes", () => {
    const id = optionsFor("transition").find(
      (o) => getParameterPromptHint(pickerNode("transition", "transition", o.id, "full")).trim().length > 0,
    )!.id
    const start = tone("start", "warm golden morning light")
    const end = tone("end", "cold blue dusk")

    for (const mode of MODES) {
      const node = pickerNode("transition", "transition", id, mode)
      const ctx: HintGraphContext = {
        nodes: [node, start, end],
        edges: [
          { source: "start", target: node.id, sourceHandle: null, targetHandle: "startState" },
          { source: "end", target: node.id, sourceHandle: null, targetHandle: "endState" },
        ],
      }
      const composed = getParameterPromptHint(node, ctx)
      expect(composed).not.toBe(getParameterPromptHint(node))
      // Derived from the catalog composer, never a hand-written sentence.
      expect(composed).toBe(
        composeTransitionHintFromConnections(
          id,
          [getParameterPromptHint(start)],
          [getParameterPromptHint(end)],
          undefined,
          mode,
        ),
      )
    }
  })

  it("character-fx: a target ref wire changes the text, in both modes", () => {
    const id = optionsFor("character-fx").find(
      (o) => getParameterPromptHint(pickerNode("character-fx", "characterFx", o.id, "full")).trim().length > 0,
    )!.id
    const mira: HintNodeLike = { id: "mira", type: "character", data: { characterName: "Mira" } }

    for (const mode of MODES) {
      const node = pickerNode("character-fx", "characterFx", id, mode)
      const ctx: HintGraphContext = {
        nodes: [node, mira],
        edges: [{ source: "mira", target: node.id, sourceHandle: null, targetHandle: "target" }],
      }
      const composed = getParameterPromptHint(node, ctx)
      expect(composed).not.toBe(getParameterPromptHint(node))
      expect(composed).toBe(composeCharacterFxHintFromConnections(id, ["Mira"], undefined, mode))
    }
  })
})
