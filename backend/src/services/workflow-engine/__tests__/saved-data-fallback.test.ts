/**
 * Saved data — a node's results as last saved in the workflow — stands in for
 * its output only when THIS run gave the node no output on purpose (a source,
 * a frozen / outside-the-subset node, a node not reached). A node that ran in
 * this run, or that a Router gated, contributes only what this run produced:
 * the worker loads the workflow once, so its saved results are an old run's.
 */
import { describe, it, expect } from "vitest"
import { resolveNodeInputs, getListFanOutForNode } from "../input-resolver.js"
import { buildNodeRefMap } from "../payload-builder.js"
import { extractSourceNodeOutput } from "../output-extractor.js"
import { executeExtractField, executeJsonProcess } from "../inline-executor.js"
import { seededFromSavedData, savedDataAllowed } from "../saved-data.js"
import type { SimpleNode, SimpleEdge, NodeExecutionState } from "../types.js"

function node(id: string, type: string, data: Record<string, unknown> = {}, parentId?: string): SimpleNode {
  return { id, type, data: { label: id, ...data }, ...(parentId ? { parentId } : {}) }
}

function edge(source: string, target: string, sourceHandle: string | null = null, targetHandle: string | null = null, data?: Record<string, unknown>): SimpleEdge {
  return { id: `e-${source}-${target}-${targetHandle ?? "x"}`, source, target, sourceHandle, targetHandle, data }
}

const STALE = [{ text: "STALE recipe from an earlier run", timestamp: "2026-01-01T00:00:00Z" }, { text: "STALE recipe two", timestamp: "2026-01-01T00:00:00Z" }]

describe("the rule", () => {
  it("allows saved data only for a seeded state, or a node this run has not reached", () => {
    expect(savedDataAllowed(undefined)).toBe(true)
    expect(savedDataAllowed(seededFromSavedData({ text: "x" }))).toBe(true)
    expect(savedDataAllowed({ status: "completed", output: { text: "ran" } })).toBe(false)
    expect(savedDataAllowed({ status: "skipped" })).toBe(false)
  })
})

describe("a fan-in (Content Ideas folding recipes)", () => {
  const ideas = node("I", "content-ideas")
  const recipeWithStaleResults = node("R", "content-recipe", { generatedResults: STALE })
  const edges = [edge("R", "I", "text", "recipes")]

  it("reads a recipe node that RAN in this run from this run — never its saved results", () => {
    const states: Record<string, NodeExecutionState> = { R: { status: "completed", output: { text: "FRESH recipe" } } }
    const inputs = resolveNodeInputs(ideas, edges, states, [recipeWithStaleResults, ideas])
    expect(inputs.inputs).toEqual(["FRESH recipe"])
  })

  it("gets nothing from a recipe node a Router gated in this run", () => {
    const states: Record<string, NodeExecutionState> = { R: { status: "skipped" } }
    const inputs = resolveNodeInputs(ideas, edges, states, [recipeWithStaleResults, ideas])
    expect(inputs.inputs).toBeUndefined()
  })

  it("still folds the saved results of a node outside a partial run (Run from here)", () => {
    const states: Record<string, NodeExecutionState> = { R: seededFromSavedData({ text: STALE[0].text }) }
    const inputs = resolveNodeInputs(ideas, edges, states, [recipeWithStaleResults, ideas])
    expect(inputs.inputs).toEqual([STALE[0].text, STALE[1].text])
  })
})

describe("a list wire from a node that ran", () => {
  const scrape = node("S", "web-scrape", { generatedJson: [{ caption: "STALE post" }] })
  const target = node("T", "llm-chat")
  const each = [edge("S", "T", "json", "in", { outputMode: "each" })]

  it("fans out over the JSON array THIS run produced, not the saved one", () => {
    const states: Record<string, NodeExecutionState> = {
      S: { status: "completed", output: { json: [{ caption: "fresh one" }, { caption: "fresh two" }] } },
    }
    const fanOut = getListFanOutForNode(target, each, states, [scrape, target])
    expect(fanOut?.items).toEqual([JSON.stringify({ caption: "fresh one" }), JSON.stringify({ caption: "fresh two" })])
  })

  it("does not fan out over saved results for a node that ran with a single result", () => {
    const states: Record<string, NodeExecutionState> = { S: { status: "completed", output: { text: "one result" } } }
    const withSavedList = node("S", "web-scrape", { generatedJson: [{ caption: "STALE a" }, { caption: "STALE b" }] })
    expect(getListFanOutForNode(target, each, states, [withSavedList, target])).toBeUndefined()
  })

  it("Generate Text's items: a node that ran never falls back to its saved text", () => {
    const writer = node("W", "llm-chat", { generatedText: "STALE one\n===NEXT===\nSTALE two" })
    const states: Record<string, NodeExecutionState> = { W: { status: "completed", output: { text: "", items: [] } } }
    const fanOut = getListFanOutForNode(target, [edge("W", "T", "items", "in")], states, [writer, target])
    expect(fanOut).toBeUndefined()
  })
})

describe("{Label} refs", () => {
  const analysis = node("VA", "video-analysis", { label: "Analysis", generatedJson: { summary: "STALE analysis" } })
  const writer = node("W", "llm-chat", { userInput: "Use {Analysis}" })
  const edges = [edge("VA", "W", "json", "in")]

  it("a node a Router gated in this run resolves to nothing, never to its saved result", () => {
    const map = buildNodeRefMap("W", { nodes: [analysis, writer], edges, nodeStates: { VA: { status: "skipped" } } })
    expect([...map.values()].join(" ")).not.toContain("STALE")
  })

  it("a node outside a partial run still resolves to its saved result", () => {
    const map = buildNodeRefMap("W", { nodes: [analysis, writer], edges, nodeStates: {} })
    expect([...map.values()].join(" ")).toContain("STALE analysis")
  })
})

describe("Group members", () => {
  it("a member that ran in this run is read from this run", () => {
    const group = node("G", "group")
    const member = node("M", "llm-chat", { generatedText: "STALE member text" }, "G")
    const states: Record<string, NodeExecutionState> = { M: { status: "completed", output: { text: "fresh member text" } } }
    const out = extractSourceNodeOutput(group, undefined, "out-text", { nodes: [group, member], edges: [], nodeStates: states })
    expect(JSON.stringify(out)).toContain("fresh member text")
    expect(JSON.stringify(out)).not.toContain("STALE")
  })

  it("read through a List column, the members are this run's too", () => {
    const group = node("G", "group")
    const member = node("M", "llm-chat", { generatedText: "STALE one\nSTALE two" }, "G")
    const list = node("L", "list", { columns: [{ id: "c1", handleId: "col-1" }] })
    const target = node("T", "llm-chat")
    const edges = [edge("G", "L", "out-text", "col-1_in"), edge("L", "T", "col-1", "in")]
    const states: Record<string, NodeExecutionState> = { M: { status: "completed", output: { text: "fresh one\nfresh two" } } }
    expect(getListFanOutForNode(target, edges, states, [group, member, list, target])?.items).toEqual(["fresh one", "fresh two"])
  })
})

describe("Extract Field and JSON Process", () => {
  const writer = node("W", "llm-chat", { generatedText: JSON.stringify({ title: "STALE title" }) })
  const extract = node("E", "extract-field", { field: "title", mode: "custom" })
  const process = node("P", "json-process", { mode: "advanced", expression: ".title" })
  const nodes = [writer, extract, process]
  const edges = [edge("W", "E", "text", "in"), edge("W", "P", "text", "in")]

  it("a node that ran with no text in this run gives nothing — never its saved text", () => {
    const states: Record<string, NodeExecutionState> = { W: { status: "completed", output: {} } }
    expect(executeExtractField(extract, edges, nodes, states).extractedText).toBe("")
    expect(JSON.stringify(executeJsonProcess(process, edges, nodes, states))).not.toContain("STALE")
  })

  it("a node a Router gated gives nothing", () => {
    const states: Record<string, NodeExecutionState> = { W: { status: "skipped" } }
    expect(executeExtractField(extract, edges, nodes, states).extractedText).toBe("")
    expect(JSON.stringify(executeJsonProcess(process, edges, nodes, states))).not.toContain("STALE")
  })

  it("a node with no state in this run still gives its saved text", () => {
    expect(executeExtractField(extract, edges, nodes, {}).extractedText).toBe("STALE title")
  })
})

describe("{Label} refs to a Split Text", () => {
  const split = node("S", "split-text", { label: "Parts", splitResults: ["STALE a", "STALE b"] })
  const writer = node("W", "llm-chat", { userInput: "Use {Parts}" })
  const edges = [edge("S", "W", "text", "in")]

  it("a Split Text a Router gated resolves to nothing, never to its saved split", () => {
    const map = buildNodeRefMap("W", { nodes: [split, writer], edges, nodeStates: { S: { status: "skipped" } } })
    expect([...map.values()].join(" ")).not.toContain("STALE")
  })

  it("one outside a partial run still resolves to its saved split", () => {
    const map = buildNodeRefMap("W", { nodes: [split, writer], edges, nodeStates: {} })
    expect([...map.values()].join(" ")).toContain("STALE a")
  })
})

describe("a dual-mode node (audio or video out)", () => {
  const changer = node("V", "voice-changer", { generatedVideoUrl: "https://cdn.example.com/STALE.mp4" })
  const merge = node("M", "merge-video-audio")
  const edges = [edge("V", "M", null, null)]

  it("that made audio in this run hands over audio — its saved video does not make it a video", () => {
    const states: Record<string, NodeExecutionState> = { V: { status: "completed", output: { audioUrl: "https://cdn.example.com/fresh.mp3" } } }
    const inputs = resolveNodeInputs(merge, edges, states, [changer, merge])
    expect(inputs.videoUrl).toBeUndefined()
    expect(JSON.stringify(inputs.audioSources)).toContain("fresh.mp3")
  })

  it("seeded from saved data, its saved video still counts", () => {
    const states: Record<string, NodeExecutionState> = { V: seededFromSavedData({ audioUrl: "https://cdn.example.com/saved.mp3" }) }
    const inputs = resolveNodeInputs(merge, edges, states, [changer, merge])
    expect(inputs.videoUrl).toBe("https://cdn.example.com/saved.mp3")
  })
})

describe("Suno track ids", () => {
  const suno = node("S", "suno-generate", { generatedResults: [{ sunoTrackId: "STALE-track", sunoTaskId: "STALE-task" }] })
  const extend = node("X", "suno-extend")
  const edges = [edge("S", "X", null, null)]

  it("a Suno node that ran gives no saved ids when its output carries none", () => {
    const states: Record<string, NodeExecutionState> = { S: { status: "completed", output: { audioUrl: "https://cdn.example.com/fresh.mp3" } } }
    const inputs = resolveNodeInputs(extend, edges, states, [suno, extend])
    expect(inputs.sunoTrackId).toBeUndefined()
    expect(inputs.sunoTaskId).toBeUndefined()
  })

  it("a frozen one still gives the ids of its saved track", () => {
    const states: Record<string, NodeExecutionState> = { S: seededFromSavedData({ audioUrl: "https://cdn.example.com/saved.mp3" }) }
    const inputs = resolveNodeInputs(extend, edges, states, [suno, extend])
    expect(inputs.sunoTrackId).toBe("STALE-track")
  })
})
