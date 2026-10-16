// tools/__tests__/units-splice.test.mjs
// spliceRegion (tools/units/templates.mjs): how gen:units writes its lines
// into hand-written files (the five i18n dicts, docs/nodes/README.md).
// @test-reads-none pure string tests
import { test } from "node:test"
import assert from "node:assert/strict"
import { spliceRegion } from "../units/templates.mjs"

const S = "  // gen:units start"
const E = "  // gen:units end"

test("replaces exactly the lines between the markers", () => {
  const src = `export const en = {\n  "a": "A",\n${S}\n  "old": "x",\n${E}\n}\n`
  assert.equal(spliceRegion(src, S, E, ['  "new": "y",']), `export const en = {\n  "a": "A",\n${S}\n  "new": "y",\n${E}\n}\n`)
  assert.equal(spliceRegion(src, S, E, []), `export const en = {\n  "a": "A",\n${S}\n${E}\n}\n`)
})

test("keeps CRLF line endings", () => {
  const src = `a\r\n${S}\r\n${E}\r\nb\r\n`
  assert.equal(spliceRegion(src, S, E, ["x"]), `a\r\n${S}\r\nx\r\n${E}\r\nb\r\n`)
})

test("idempotent", () => {
  const src = `a\n${S}\n${E}\n`
  const once = spliceRegion(src, S, E, ["1", "2"])
  assert.equal(spliceRegion(once, S, E, ["1", "2"]), once)
})

test("refuses a missing, duplicated or reversed region", () => {
  assert.throws(() => spliceRegion("a\n", S, E, []), /exactly one/)
  assert.throws(() => spliceRegion(`${S}\n${S}\n${E}\n`, S, E, []), /found 2 and 1/)
  assert.throws(() => spliceRegion(`${E}\n${S}\n`, S, E, []), /exactly one/)
  assert.throws(() => spliceRegion(`  // gen:units start extra\n${E}\n`, S, E, []), /found 0 and 1/, "a marker is a whole line")
})
