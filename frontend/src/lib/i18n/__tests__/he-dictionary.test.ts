// @vitest-environment node
import { describe, it, expect } from "vitest"
import { en } from "../en"
import { he } from "../he"
import { LABELS_HE } from "../labels.he"

/**
 * The mechanical half of the Hebrew style guide (frontend/CLAUDE.md, "Hebrew
 * conventions"): typography and the owner's terms, the rules a reviewer should
 * never have to point out twice. Applies to the whole dictionary and to the
 * label tables, not only to the editor's keys (config-panel-glossary.test.ts
 * holds the editor-only rules).
 */

const HEB = "א-ת"
const NOT_HEB_BEFORE = `(?<![${HEB}])`
const NOT_HEB_AFTER = `(?![${HEB}])`

const ALL: ReadonlyArray<readonly [string, string]> = [
  ...Object.entries(he).filter((e): e is [string, string] => typeof e[1] === "string"),
  ...Object.entries(LABELS_HE).flatMap(([table, rows]) =>
    Object.entries(rows as Record<string, string>).map(([k, v]) => [`labels.${table}:${k}`, v] as const),
  ),
]

function hits(test: (value: string, key: string) => boolean): string[] {
  return ALL.filter(([k, v]) => /[א-ת]/.test(v) && test(v, k)).map(([k, v]) => `${k} = ${v}`)
}

describe("Hebrew typography", () => {
  it("uses the single ellipsis character, never three dots", () => {
    expect(hits((v) => v.includes("..."))).toEqual([])
  })
  it("quotes with straight quotes, never curly ones", () => {
    expect(hits((v) => /[„“”]/.test(v))).toEqual([])
  })
  it("uses gershayim only inside acronyms, never as quotation marks", () => {
    expect(hits((v) => new RegExp(`(^|[\\s(:])[${HEB}]{0,3}״[^״]+״`).test(v))).toEqual([])
  })
  it("joins a Hebrew prefix to Latin text, a number or a placeholder with a maqaf, never a hyphen", () => {
    expect(hits((v) => new RegExp(`${NOT_HEB_BEFORE}[בהוכלמש]{1,3}-[A-Za-z0-9{]`).test(v))).toEqual([])
  })
  it("shows no escaped quote to the user", () => {
    expect(hits((v) => v.includes('\\"'))).toEqual([])
  })
  it("spells הכול and דוגמה in full", () => {
    expect(hits((v) => new RegExp(`${NOT_HEB_BEFORE}[ובמשכ]{0,2}הכל${NOT_HEB_AFTER}|דוגמא${NOT_HEB_AFTER}`).test(v))).toEqual([])
  })
})

describe("Hebrew terms and register", () => {
  it("reference is רפרנס, never ייחוס", () => {
    expect(hits((v) => v.includes("ייחוס"))).toEqual([])
  })
  it("preset is פריסט, never ערכה", () => {
    expect(
      hits((v, k) => new RegExp(`${NOT_HEB_BEFORE}[הבלו]?ערכ(?:ה|ות)${NOT_HEB_AFTER}`).test(v) && /preset/i.test(en[k as keyof typeof en] ?? "")),
    ).toEqual([])
  })
  it("says what is meant instead of the upstream/downstream calque", () => {
    expect(hits((v) => /במ(?:עלה|ורד) ה?זרם/.test(v))).toEqual([])
  })
  it("addresses the user in the plural, never in the singular", () => {
    expect(hits((v) => new RegExp(`${NOT_HEB_BEFORE}(?:שלך|לך|אותך|ממך|אליך|בשבילך|עבורך)${NOT_HEB_AFTER}`).test(v))).toEqual([])
  })
  it("a workflow is a תהליך עבודה", () => {
    // A back-reference ("התהליך") is fine once the string has named the workflow; a sub-workflow is a תת־תהליך.
    expect(
      hits(
        (v, k) =>
          /\bworkflows?\b/i.test(en[k as keyof typeof en] ?? "") &&
          /תהלי(?:ך|כים|כי)/.test(v) &&
          !/עבודה/.test(v) &&
          !/תת[־-]ה?תהלי|תתי[־-]ה?תהליכים/.test(v),
      ),
    ).toEqual([])
  })
})
