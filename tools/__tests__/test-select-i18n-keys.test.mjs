// tools/__tests__/test-select-i18n-keys.test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { changedKeys, keyUsage } from "../test-select/i18n-keys.mjs"
import { selectTests } from "../test-select/select.mjs"

const dict = (entries) => `import x from "y"\nexport const en = {\n  // ── Area\n${Object.entries(entries).map(([k, v]) => `  "${k}": "${v}",`).join("\n")}\n} as const\n`

test("changed keys: added, removed and rewritten entries; anything else is a doubt", () => {
  assert.deepEqual(changedKeys(dict({ "a.x": "1", "a.y": "2" }), dict({ "a.x": "1", "a.y": "3", "b.z": "4" })), ["a.y", "b.z"])
  assert.deepEqual(changedKeys(dict({ "a.x": "1", "a.y": "2" }), dict({ "a.x": "1" })), ["a.y"])
  assert.equal(changedKeys(dict({ "a.x": "1" }), dict({ "a.x": "1" }).replace("from \"y\"", "from \"z\"")), null, "an import changed")
  assert.equal(changedKeys(dict({ "a.x": "1" }), `${dict({ "a.x": "1" })}export const extra = 1\n`), null)
  assert.deepEqual(changedKeys(dict({ "a.x": "1" }), dict({ "a.x": "1" }).replace("// ── Area", "// ── Renamed area")), [], "a comment only")
  assert.equal(changedKeys(null, dict({})), null)
})

const F = (path, source) => ({ path, source })
test("key users: literal namers plus every module that reads the dicts as data", () => {
  const files = [
    F("frontend/src/gallery/page.tsx", `t("gallery.title")`),
    F("frontend/src/nodes/pitch.tsx", `t("pitch.label")`),
    F("frontend/src/lib/i18n/index.ts", `import { en } from "./en"`),
    F("frontend/src/lib/i18n/__tests__/complete.test.ts", `import { en } from "../en"\nObject.keys(en).filter((k) => k.startsWith("gallery."))`),
    F("frontend/src/lib/api-error-copy.ts", `import { en } from "@/lib/i18n/en"`),
    F("frontend/src/lib/typed.ts", `import type { MessageKey } from "@/lib/i18n/en"`),
  ]
  const u = keyUsage(["gallery.title"], files)
  assert.deepEqual([...u.users].sort(), ["frontend/src/gallery/page.tsx", "frontend/src/lib/api-error-copy.ts", "frontend/src/lib/i18n/__tests__/complete.test.ts"])
})

test("a key that may be built at run time turns key-level selection off", () => {
  const base = [F("frontend/src/a.tsx", `t("nodes.pitch.label")`)]
  assert.match(keyUsage(["nodes.other.label"], base).unsafe, /no source names/)
  assert.match(keyUsage(["nodes.pitch.label"], [...base, F("frontend/src/b.tsx", "t(`nodes.${type}.label`)")]).unsafe, /template literal/)
  assert.match(keyUsage(["nodes.pitch.label"], [...base, F("frontend/src/c.tsx", `t("nodes." + type + ".label")`)]).unsafe, /prefix "nodes\."/)
  // a generic `${a}.${b}` or a file name template cannot build a key
  assert.ok(keyUsage(["nodes.pitch.label"], [...base, F("frontend/src/d.ts", "`${a}.${b}`; `${name}.png`")]).users)
})

test("selection: a narrowed dict change selects only its key users; without key info, today's rule", () => {
  const T = (file, deps) => ({ file, deps, watches: [], always: null, scanner: false, reads: [], undeclaredReader: null })
  const dictPath = "frontend/src/lib/i18n/en.ts"
  const tests = [
    T("frontend/src/gallery/__tests__/page.test.tsx", ["frontend/src/gallery/page.tsx", dictPath]),
    T("frontend/src/nodes/__tests__/pitch.test.tsx", ["frontend/src/nodes/pitch.tsx", dictPath]),
  ]
  const narrowed = selectTests({ project: "frontend", tests, changes: [{ status: "M", path: dictPath, i18nUsers: ["frontend/src/gallery/page.tsx"] }] })
  assert.deepEqual(narrowed.files.map((f) => f.file), ["frontend/src/gallery/__tests__/page.test.tsx"])
  const plain = selectTests({ project: "frontend", tests, changes: [{ status: "M", path: dictPath }] })
  assert.equal(plain.files.length, 2)
})
