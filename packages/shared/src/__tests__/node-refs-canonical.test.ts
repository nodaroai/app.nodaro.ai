import { describe, it, expect } from "vitest"
import {
  resolveNodeRefs,
  extractReferencedLabels,
  combineSameLabelRefs,
  canonicalVarName,
} from "../node-refs.js"

// Node-name variables are CASE-INSENSITIVE with lowercase as canonical: nodes
// labeled TEXt / TEXT / text all feed ONE {text} variable, and {TEXT}/{Text}/
// {text} in a prompt all resolve to it.
describe("case-insensitive node variables (canonicalVarName)", () => {
  it("canonicalVarName trims + lowercases", () => {
    expect(canonicalVarName("  TEXt ")).toBe("text")
    expect(canonicalVarName("TEXT")).toBe("text")
    expect(canonicalVarName("text")).toBe("text")
  })

  it("resolveNodeRefs resolves {TEXT}/{Text}/{text} against a canonical-keyed map", () => {
    const map = new Map([["text", "a cat"]])
    expect(resolveNodeRefs("{TEXT}", map)).toBe("a cat")
    expect(resolveNodeRefs("{Text}", map)).toBe("a cat")
    expect(resolveNodeRefs("{text}", map)).toBe("a cat")
  })

  it("resolveNodeRefs still honors an exact-cased map first (condition-variables)", () => {
    // Original-cased maps (e.g. selector/filter condition variables) keep working.
    const map = new Map([["MyVar", "v"]])
    expect(resolveNodeRefs("{MyVar}", map)).toBe("v")
  })

  it("extractReferencedLabels returns canonical (lowercase) names", () => {
    const refs = extractReferencedLabels("a {TEXt} and {FOO}")
    expect(refs.has("text")).toBe(true)
    expect(refs.has("foo")).toBe(true)
    expect(refs.has("TEXt")).toBe(false)
  })

  it("combineSameLabelRefs collapses TEXt/TEXT/text into one canonical {text}", () => {
    const combined = combineSameLabelRefs([
      { label: "TEXt", output: "p", category: 0 }, // prompt handle
      { label: "TEXT", output: "e", category: 1 }, // elements handle
      { label: "text", output: "l", category: 2 }, // look handle
    ])
    expect([...combined.keys()]).toEqual(["text"])
    expect(combined.get("text")).toBe("p, e, l") // prompt → elements → look
  })

  it("reserved template vars stay case-sensitive (left literal, not canonicalized)", () => {
    const map = new Map([["userprompt", "x"]])
    // {userPrompt} is reserved → untouched, NOT resolved to the `userprompt` entry.
    expect(resolveNodeRefs("{userPrompt}", map)).toBe("{userPrompt}")
  })
})
