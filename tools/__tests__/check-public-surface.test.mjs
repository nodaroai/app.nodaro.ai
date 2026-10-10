// The public-surface rule for a third-party source's name: every spelling of it
// is a finding, and the platform's own camera-motion tool, whose name contains
// it, never is. The history gate imports the same rules, so this pins both.
//
// Every name here is built at runtime (never a literal): the publish path greps
// FIXED private markers across every tracked file, so a test that spelled its
// own target would abort the mirror on itself. The last test pins that, for the
// guard and for this file.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { ruleTrippedByLine } from "../check-public-surface.mjs"

const FIRST = ["mo", "ion"].join("t")
const SECOND = ["l", "b"].join("a")
const cap = (word) => word[0].toUpperCase() + word.slice(1)

/** The name spaced, in capitals, joined, hyphenated and underscored. */
const SPELLINGS = [
  `${cap(FIRST)} ${cap(SECOND)}`,
  `${FIRST} ${SECOND}`.toUpperCase(),
  `${cap(FIRST)}${cap(SECOND)}`,
  `${FIRST}-${SECOND}`,
  `${FIRST}_${SECOND}`,
]
/** The platform's own camera-motion tool: in prose, as a slug, as an identifier. */
const OWN_TOOL = [
  `Camera ${cap(FIRST)} ${cap(SECOND)}`,
  `camera-${FIRST}-${SECOND}`,
  `Camera${cap(FIRST)}${cap(SECOND)}`,
]
const FILES = ["docs/nodes/presets.md", "backend/src/lib/example.ts", "packages/prompts/src/example.ts"]

test("every spelling of the third-party name is a finding, in any public file", () => {
  for (const file of FILES) {
    for (const name of SPELLINGS) {
      assert.equal(ruleTrippedByLine(file, `// adapted from the ${name} notes`)?.id, "competitor-citation", `${file}: ${name}`)
      assert.equal(ruleTrippedByLine(file, name)?.id, "competitor-citation", `${file}: ${name} on its own`)
    }
  }
})

test("the platform's own camera-motion tool is never a finding", () => {
  for (const file of FILES) {
    for (const name of OWN_TOOL) {
      assert.equal(ruleTrippedByLine(file, `// approved on screen in the ${name}.`), null, `${file}: ${name}`)
      assert.equal(ruleTrippedByLine(file, name), null, `${file}: ${name} on its own`)
    }
  }
})

test("the exemption covers only the occurrence after 'camera' — a line that also names the source is a finding", () => {
  const line = `// approved in the ${OWN_TOOL[0]}, not taken from ${SPELLINGS[0]}`
  assert.equal(ruleTrippedByLine("backend/src/lib/example.ts", line)?.id, "competitor-citation")
})

test("words that only contain the two parts are not findings", () => {
  const words = [
    `getCamera${cap(FIRST)}${cap(SECOND)}el`,
    `e${FIRST}${cap(SECOND)}els`,
    `${FIRST}_${SECOND}els`.toUpperCase(),
    `pro${FIRST} ${SECOND}`,
    `${FIRST} ${SECOND}el`,
  ]
  for (const word of words) assert.equal(ruleTrippedByLine("frontend/src/example.tsx", `const x = ${word}`), null, word)
})

test("neither the guard nor this test spells the name", () => {
  const forms = [" ", "-", "_", ""].map((sep) => `${FIRST}${sep}${SECOND}`)
  for (const url of [new URL("../check-public-surface.mjs", import.meta.url), new URL(import.meta.url)]) {
    const text = readFileSync(url, "utf8").toLowerCase()
    for (const [i, form] of forms.entries()) assert.ok(!text.includes(form), `${url.pathname} carries the name (form ${i + 1})`)
  }
})
