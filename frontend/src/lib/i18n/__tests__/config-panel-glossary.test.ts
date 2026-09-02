import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { en } from "../en"
import { he } from "../he"

/**
 * Glossary guard for the Hebrew strings the EDITOR renders (config panels,
 * node cards, presets, cost drawer): node = רכיב (never צומת), reference =
 * ייחוס (never הפניה — a cross-reference/link), "(optional)" = (אופציונלי).
 * A key from another page (executions table, marketplace) may legitimately
 * keep its own term, so only keys actually rendered by editor components are
 * checked — found by scanning their source for the quoted key.
 */
const SRC = path.resolve(__dirname, "../../..")
function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "__tests__" || e.name === "node_modules") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(e.name)) out.push(p)
  }
  return out
}
// Every quoted dotted token in the editor's source — the keys it renders.
// Collected ONCE (a substring search per dictionary key over the multi-MB
// source timed out under the parallel suite).
const editorKeys = new Set<string>()
for (const f of [...walk(path.join(SRC, "components/editor")), ...walk(path.join(SRC, "components/nodes"))]) {
  for (const m of fs.readFileSync(f, "utf8").matchAll(/"([a-z][A-Za-z0-9]*\.[A-Za-z0-9.]+)"/g)) editorKeys.add(m[1])
}

const RULES: ReadonlyArray<{ name: string; bad: RegExp; when?: (enValue: string) => boolean }> = [
  { name: "node → רכיב", bad: /צומת|צמתים/ },
  // The NOUN only (הפניה / הפניות, with a ל- or ה- prefix); הפניתם is the verb "you referred", fine.
  { name: "reference → ייחוס", bad: /(?:^|[\s,(—-])[להו]?הפני(?:ה|ות)\b/, when: (e) => /referen/i.test(e) },
  { name: "(optional) → (אופציונלי)", bad: /\(רשות\)|לא חובה/ },
]

describe("Hebrew glossary in the editor's rendered keys", () => {
  for (const rule of RULES) {
    it(rule.name, () => {
      const hits = Object.entries(he)
        .filter(([k, v]) => editorKeys.has(k) && rule.bad.test(v as string) && (!rule.when || rule.when(en[k as keyof typeof en] ?? "")))
        .map(([k, v]) => `${k} = ${v}`)
      expect(hits, `${rule.name}:\n${hits.join("\n")}`).toEqual([])
    })
  }
  it("sees the editor's keys (the guard is not vacuous)", () => {
    expect(editorKeys.has("field.injectedReferences")).toBe(true)
    expect(editorKeys.has("cfgshared.custom")).toBe(true)
    expect(editorKeys.size).toBeGreaterThan(1500)
  })
})
