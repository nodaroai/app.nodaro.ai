// tools/__tests__/test-select-mocks.test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { factoryMockedSpecifiers as mocked } from "../test-select/mocks.mjs"

test("an inline factory that never reaches the real module drops the edge", () => {
  assert.deepEqual(mocked(`vi.mock("../credits.js", () => ({ quote: vi.fn() }))`), ["../credits.js"])
  assert.deepEqual(mocked(`vi.mock('@/lib/api', async () => {\n  return { get: vi.fn() }\n})`), ["@/lib/api"])
  assert.deepEqual(mocked("vi.mock(`./x`, function () { return {} })"), ["./x"])
  assert.deepEqual(mocked(`vi.mock("./a", () => ({}))\nvi.mock("./b", () => ({}))`), ["./a", "./b"])
})

test("every form that may load the real module keeps the edge", () => {
  for (const src of [
    `vi.mock("./x")`, // automock or __mocks__
    `vi.mock("./x", { spy: true })`,
    `vi.mock("./x", factory)`, // not inline: cannot inspect
    `vi.mock("./x", async (importOriginal) => ({ ...(await importOriginal()), a: 1 }))`,
    `vi.mock("./x", async () => ({ ...(await vi.importActual("./x")), a: 1 }))`,
    `vi.mock("./x", async () => ({ ...(await vi.importMock("./x")) }))`,
    `vi.mock("./x", async () => { const m = await import("./x"); return m })`,
    `vi.mock("./x", () => require("./x"))`,
    `vi.mock(path, () => ({}))`, // not a literal
    "vi.mock(`./${name}`, () => ({}))",
    `vi.mock("./x", () => ({}))\nvi.unmock("./x")`,
    `vi.mock("./x", () => ({}))\nvi.doUnmock("./x")`,
    `vi.doMock("./x", () => ({}))`,
    `vi.mock("./x", () => ({}))\nvi.doMock("./x", () => ({ b: 1 }))`,
    `vi.mock("./x", () => ({}), extra)`,
  ]) assert.deepEqual(mocked(src), [], src)
})

test("strings, comments and nested calls inside the factory do not confuse the argument split", () => {
  assert.deepEqual(mocked(`vi.mock("./x", () => ({ s: "a, b ) c", f: (a, b) => [a, b], t: \`x \${1}\` }))`), ["./x"])
  // a comment before the factory makes it unreadable: keep the edge
  assert.deepEqual(mocked(`vi.mock("./x", // why\n () => ({}))`), [])
  // an import( anywhere in the factory, even of another module, keeps it (cannot tell)
  assert.deepEqual(mocked(`vi.mock("./x", async () => ({ y: (await import("./y")).y }))`), [])
})
