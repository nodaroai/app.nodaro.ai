/**
 * The editor's panels name a wired Character node exactly as the run does
 * (decided 2026-11-11): each unnamed node is its own "Character N", numbered
 * in wire order, skipping a number another wired character is called. Every
 * panel builder below is read against the run's own expansion
 * (`expandWiredCharacterRefsForVideo`, what the editor's Run sends) over the
 * same graph, and against the literal names the workflow run gives
 * (backend `payload-builder-unnamed-characters.test.ts`).
 */
import { describe, it, expect } from "vitest"
import { characterReferencesFromWired } from "@nodaro/shared/video"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"
import { buildImageConnectedReferences } from "../connected-references"
import { buildConnectedRefsFromSources } from "../connected-refs-builder"
import { buildVideoRefAutocomplete } from "../video-configs"
import { getConnectedSources } from "../helpers"
import { expandWiredCharacterRefsForVideo } from "@/lib/video-prompt-assembly"

function character(id: string, extra: Record<string, unknown> = {}): WorkflowNode {
  return {
    id,
    type: "character",
    position: { x: 0, y: 0 },
    data: {
      label: "Character Asset",
      characterName: "",
      sourceImageUrl: `https://cdn.example/${id}.png`,
      canonicalDescription: `the ${id} look`,
      ...extra,
    },
  } as unknown as WorkflowNode
}
const consumer = { id: "c", type: "generate-video", position: { x: 0, y: 0 }, data: { provider: "kling-4" } } as unknown as WorkflowNode
const wire = (source: string, sourceHandle = "characterRef", targetHandle = "assets"): WorkflowEdge =>
  ({ id: `${source}->c`, source, target: "c", sourceHandle, targetHandle }) as WorkflowEdge

/** The canonical character entries' [name, slug] of a builder's output, in order. */
const canon = (refs: ReadonlyArray<{ source: string; variantSlug?: string; defaultName: string; characterSlug?: string }>) =>
  refs.filter((r) => r.source === "wired-character" && !r.variantSlug).map((r) => [r.defaultName, r.characterSlug])

function all(nodes: WorkflowNode[], edges: WorkflowEdge[]) {
  const sources = getConnectedSources("c", edges, nodes)
  return {
    run: canon(expandWiredCharacterRefsForVideo("c", nodes, edges)),
    image: canon(buildImageConnectedReferences({ data: {}, sources, nodes, attachedChars: [] })),
    builder: canon(buildConnectedRefsFromSources(sources)),
    video: canon(buildVideoRefAutocomplete(sources)),
  }
}

describe("panel previews name characters as the run does", () => {
  it("two unnamed nodes: Character 1 and Character 2 everywhere", () => {
    const nodes = [character("u1"), character("u2"), consumer]
    const r = all(nodes, [wire("u1"), wire("u2")])
    const expected = [["Character 1", "character-1"], ["Character 2", "character-2"]]
    expect(r).toEqual({ run: expected, image: expected, builder: expected, video: expected })
  })

  it("a mixed list (named, unnamed, named, unnamed) — the workflow run's names", () => {
    const nodes = [character("a", { characterName: "Maya" }), character("b"), character("d", { label: "Leo" }), character("e"), consumer]
    const r = all(nodes, [wire("a"), wire("b"), wire("d"), wire("e")])
    const expected = [["Maya", "maya"], ["Character 1", "character-1"], ["Leo", "leo"], ["Character 2", "character-2"]]
    expect(r).toEqual({ run: expected, image: expected, builder: expected, video: expected })
    // And the Kling subjects the editor's Run sends carry the same names.
    expect(characterReferencesFromWired(expandWiredCharacterRefsForVideo("c", nodes, [wire("a"), wire("b"), wire("d"), wire("e")])).map((s) => s.name))
      .toEqual(["Maya", "Character 1", "Leo", "Character 2"])
  })

  it("an unnamed node beside one named Character 1 is Character 2", () => {
    const nodes = [character("u1"), character("n1", { characterName: "Character 1" }), consumer]
    const r = all(nodes, [wire("u1"), wire("n1")])
    const expected = [["Character 2", "character-2"], ["Character 1", "character-1"]]
    expect(r).toEqual({ run: expected, image: expected, builder: expected, video: expected })
  })

  it("a character wired into a frame still takes its number, so later ones keep the run's numbering", () => {
    // The image panel lists no frame wires as references, but the run numbers
    // over every wire: the second unnamed node is Character 2 in both.
    const nodes = [character("u1"), character("u2"), consumer]
    const r = all(nodes, [wire("u1", "characterRef", "startFrame"), wire("u2")])
    expect(r.run).toEqual([["Character 1", "character-1"], ["Character 2", "character-2"]])
    expect(r.image).toEqual([["Character 2", "character-2"]])
  })

  it("non-Latin names (he / ja / ko) are named as typed and keyed character-N, as the run does; the autocomplete offers that key", () => {
    for (const typed of ["מאיה", "マヤ", "마야"]) {
      const nodes = [character("u1"), character("x", { characterName: typed }), character("l", { characterName: "Leo" }), consumer]
      const edges = [wire("u1"), wire("x"), wire("l")]
      const r = all(nodes, edges)
      const expected = [["Character 1", "character-1"], [typed, "character-2"], ["Leo", "leo"]]
      expect(r).toEqual({ run: expected, image: expected, builder: expected, video: expected })
      // The @-autocomplete entry for the typed name carries the key a mention resolves by.
      const entry = buildVideoRefAutocomplete(getConnectedSources("c", edges, nodes)).find((e) => e.defaultName === typed)
      expect(entry?.characterSlug).toBe("character-2")
    }
  })

  it("the portrait is the node's output: a generated result beats the source image when nothing is starred", () => {
    const nodes = [character("u1", { generatedResults: [{ url: "https://cdn.example/r.png" }], activeResultIndex: 0 }), consumer]
    const sources = getConnectedSources("c", [wire("u1")], nodes)
    const urls = (refs: ReadonlyArray<{ source: string; variantSlug?: string; url: string }>) =>
      refs.filter((x) => x.source === "wired-character" && !x.variantSlug).map((x) => x.url)
    expect(urls(expandWiredCharacterRefsForVideo("c", nodes, [wire("u1")]))).toEqual(["https://cdn.example/r.png"])
    expect(urls(buildImageConnectedReferences({ data: {}, sources, nodes, attachedChars: [] }))).toEqual(["https://cdn.example/r.png"])
    expect(urls(buildConnectedRefsFromSources(sources))).toEqual(["https://cdn.example/r.png"])
    expect(urls(buildVideoRefAutocomplete(sources))).toEqual(["https://cdn.example/r.png"])
  })

  it("through a Teleport pair the panel names the ORIGIN node as the run does", () => {
    const send = { id: "ts", type: "teleport-send", position: { x: 0, y: 0 }, data: {} } as unknown as WorkflowNode
    const recv = { id: "tr", type: "teleport-receive", position: { x: 0, y: 0 }, data: { teleporter: "ts" } } as unknown as WorkflowNode
    const nodes = [character("u1"), character("u2"), send, recv, consumer]
    const edges = [
      { id: "u1->ts", source: "u1", target: "ts", sourceHandle: "characterRef", targetHandle: "in" } as WorkflowEdge,
      { id: "ts->tr", source: "ts", target: "tr", sourceHandle: "out", targetHandle: "in", data: { teleporter: true } } as unknown as WorkflowEdge,
      { id: "tr->c", source: "tr", target: "c", sourceHandle: "out", targetHandle: "assets" } as WorkflowEdge,
      wire("u2"),
    ]
    const sources = getConnectedSources("c", edges, nodes)
    expect(canon(buildConnectedRefsFromSources(sources))).toEqual([["Character 1", "character-1"], ["Character 2", "character-2"]])
  })
})
