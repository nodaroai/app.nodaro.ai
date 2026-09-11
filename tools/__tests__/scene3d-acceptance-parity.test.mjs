// Server-side input parity for the controlled A/B.
//
// The claim an A/B makes is "only the thing under test differs" — about what
// the SERVER stored, not about what the harness believes it sent. These tests
// cover the ways that claim breaks: a route that defaults a field on one arm,
// one that reorders an array, one that injects something neither arm asked
// for, and a prompt whose shared body is not actually shared.
import { test } from "node:test"
import assert from "node:assert/strict"
import { compareInputs, comparePromptBodies, deepEqual, differingKeys, shortHash, summarize } from "../scene3d-acceptance/lib/parity.mjs"
import { ALLOWED_DIFFERING_KEYS } from "../scene3d-acceptance/commands/seedance-ab.mjs"

const armA = {
  provider: "seedance-2-5", duration: 4, resolution: "480p", aspectRatio: "16:9", sound: false,
  referenceImageUrls: ["https://cdn.test/image.png"], prompt: "common body", userPrompt: "common body",
}
const armB = { ...armA, prompt: "common body\n\nscoping", userPrompt: "common body\n\nscoping", referenceVideoUrls: ["https://cdn.test/clay.mp4"] }

test("key order does not matter, array order does", () => {
  assert.equal(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 }), true)
  assert.equal(deepEqual(["a", "b"], ["b", "a"]), false, "reference ORDER is meaningful to the model")
  assert.equal(deepEqual(null, undefined), false)
})

test("the intended A/B difference passes parity", () => {
  const report = compareInputs(armA, armB, { allowed: ALLOWED_DIFFERING_KEYS })
  assert.deepEqual(report.differingKeys, ["prompt", "referenceVideoUrls", "userPrompt"])
  assert.deepEqual(report.unexpectedKeys, [])
  assert.equal(report.pass, true)
})

test("a field the server defaulted on ONE arm fails parity", () => {
  const defaulted = { ...armB, seed: 12345 }
  const report = compareInputs(armA, defaulted, { allowed: ALLOWED_DIFFERING_KEYS })
  assert.deepEqual(report.unexpectedKeys, ["seed"])
  assert.equal(report.pass, false)
})

test("a key present on one arm and absent on the other is a difference, not a match", () => {
  assert.deepEqual(differingKeys({ a: 1 }, {}), ["a"])
  const report = compareInputs(armA, { ...armB, sound: undefined }, { allowed: ALLOWED_DIFFERING_KEYS })
  assert.ok(report.unexpectedKeys.includes("sound"))
})

test("a silently reordered reference array fails parity", () => {
  const a = { ...armA, referenceImageUrls: ["https://cdn.test/1.png", "https://cdn.test/2.png"] }
  const b = { ...armB, referenceImageUrls: ["https://cdn.test/2.png", "https://cdn.test/1.png"] }
  assert.equal(compareInputs(a, b, { allowed: ALLOWED_DIFFERING_KEYS }).pass, false)
})

test("the summary describes shape and size, never content", () => {
  const report = compareInputs(armA, armB, { allowed: ALLOWED_DIFFERING_KEYS })
  const promptLine = report.summary.find((s) => s.key === "prompt")
  assert.equal(promptLine.a.kind, "string")
  assert.equal(promptLine.a.length, "common body".length)
  assert.ok(/^[0-9a-f]{16}$/.test(promptLine.a.sha))
  assert.equal(promptLine.expected, true)
  // No entry anywhere in the report reprints the prompt itself.
  assert.equal(JSON.stringify(report).includes("common body"), false)
})

test("summarize names an absent value as absent rather than null", () => {
  assert.deepEqual(summarize(undefined), { kind: "absent" })
  assert.deepEqual(summarize(null), { kind: "null" })
  assert.deepEqual(summarize({ b: 1, a: 2 }), { kind: "object", keys: ["a", "b"] })
  assert.equal(summarize([1, 2]).length, 2)
})

test("shortHash is stable, and different for different text", () => {
  assert.equal(shortHash("abc"), shortHash("abc"))
  assert.notEqual(shortHash("abc"), shortHash("abd"))
  assert.ok(/^[0-9a-f]{16}$/.test(shortHash("")))
})

test("arm B must EXTEND arm A verbatim — that is what makes the body shared", () => {
  const report = comparePromptBodies("common body", "common body\n\nscoping line")
  assert.equal(report.armBExtendsArmA, true)
  assert.equal(report.addedText, "scoping line")
  assert.equal(report.pass, true)
})

test("a rewritten common body is caught, and an identical pair is not an A/B at all", () => {
  assert.equal(comparePromptBodies("common body", "COMMON body\n\nscoping").pass, false)
  const identical = comparePromptBodies("same", "same")
  assert.equal(identical.armBExtendsArmA, true)
  assert.equal(identical.pass, false, "no added text means the arms are not testing anything")
})
