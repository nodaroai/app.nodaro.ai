// tools/__tests__/test-select-package-symbols.test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { affectedNames, exportedNames, importedNames } from "../test-select/package-symbols.mjs"
import { selectTests } from "../test-select/select.mjs"

const S = (path, source) => ({ path: `packages/shared/src/${path}`, source })
const pkg = [
  S("pricing.ts", `export const PRICE = 1\nexport function quote() { return PRICE }`),
  S("credits.ts", `import { quote } from "./pricing.js"\nexport const total = () => quote()\nexport type Credit = number`),
  S("edl.ts", `export interface Edl {}\nexport const EDL_VERSION = 3`),
  S("entries/credits.ts", `export { total, type Credit } from "../credits.js"\nexport { PRICE } from "../pricing.js"`),
  S("entries/edl.ts", `export * from "../edl.js"`),
  S("i18n/loader.ts", "export const load = (l) => import(`./strings.${l}.js`)"),
  S("i18n/strings.he.ts", `export default { hi: "שלום" }`),
  S("register.ts", `import { add } from "./registry.js"\nadd("x")\nexport const marker = 1`),
]

test("a change reaches the names of every module that imports it, transitively", () => {
  assert.deepEqual([...affectedNames(pkg, ["packages/shared/src/pricing.ts"])].sort(), ["Credit", "PRICE", "quote", "total"])
  assert.deepEqual([...affectedNames(pkg, ["packages/shared/src/edl.ts"])].sort(), ["EDL_VERSION", "Edl"])
  // a module loaded only through a template import reaches its loader
  assert.deepEqual([...affectedNames(pkg, ["packages/shared/src/i18n/strings.he.ts"])], ["load"])
})

test("doubt returns null: a top-level call, an unknown or out-of-src file", () => {
  assert.equal(affectedNames(pkg, ["packages/shared/src/register.ts"]), null)
  assert.equal(affectedNames(pkg, ["packages/shared/src/missing.ts"]), null)
  assert.equal(affectedNames(pkg, ["packages/shared/package.json"]), null)
})

test("exported and imported names", () => {
  assert.deepEqual([...exportedNames(`export const a = 1\nexport async function b() {}\nexport { c as d, type E }\nexport default 1`)].sort(), ["E", "a", "b", "d"])
  assert.deepEqual([...importedNames(`import { a, b as c, type T } from "@nodaro/shared/edl"\nimport { z } from "@nodaro/shared"`)].sort(), ["T", "a", "b", "z"])
  assert.equal(importedNames(`import x from "react"`), null)
  for (const src of [`import * as S from "@nodaro/shared"`, `const m = await import("@nodaro/shared/edl")`, `vi.mock("@nodaro/shared/edl", () => ({}))`, `export * from "@nodaro/shared"`]) {
    assert.equal(importedNames(src), "*", src)
  }
})

test("selection: a test that imports none of the reached names is not selected through the package", () => {
  const T = (file, deps, sharedImports) => ({ file, deps, watches: [], always: null, scanner: false, reads: [], undeclaredReader: null, sharedImports })
  const dist = "packages/shared/dist/chunk-A.js"
  const tests = [
    T("frontend/src/a.test.ts", ["frontend/src/a.ts", dist], ["total"]),
    T("frontend/src/b.test.ts", ["frontend/src/b.ts", dist], ["EDL_VERSION"]),
    T("frontend/src/c.test.ts", ["frontend/src/c.ts", dist], "*"),
    T("frontend/src/d.test.ts", ["frontend/src/d.ts", dist, "packages/prompts/dist/index.js"], ["EDL_VERSION"]),
  ]
  const change = (extra) => [{ status: "M", path: "packages/shared/src/pricing.ts", ...extra }]
  const sel = selectTests({ project: "frontend", tests, changes: change({ sharedNames: ["Credit", "PRICE", "quote", "total"] }) })
  assert.deepEqual(sel.files.map((f) => f.file), ["frontend/src/a.test.ts", "frontend/src/c.test.ts", "frontend/src/d.test.ts"])
  // without names: the package rule, every user
  assert.equal(selectTests({ project: "frontend", tests, changes: change({}) }).files.length, 4)
})
