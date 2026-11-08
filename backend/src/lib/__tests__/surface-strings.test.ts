// @test-watches frontend/src/lib/i18n/en.{ts,js} frontend/src/lib/i18n/platform-languages.{ts,js}
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, it, expect, vi, afterEach } from "vitest"
import { buildUiStringManifest, uiStringManifestFile, type UiStringManifest } from "@nodaro/shared/runtime-config"
import { en } from "../../../../frontend/src/lib/i18n/en.js"
import { PLATFORM_LANGUAGES } from "../../../../frontend/src/lib/i18n/platform-languages.js"
import { FRONTEND_BUILD_DIR, UI_STRINGS_MAX_BYTES, UI_STRING_MAX_LENGTH, readUiStringManifest, resolveSurfaceStrings, uiStringTextProblem } from "../surface-strings.js"

/**
 * A deployment's UI-string overrides, checked against the key manifest the
 * editor's build emits before /config.js carries them. Each bad entry is
 * dropped alone with a warning; nothing here ever throws or fails a boot.
 *
 * The manifest is generated in memory from the dictionaries on every run, so a
 * new string cannot make this file stale.
 */

const FLOW: UiStringManifest = buildUiStringManifest("flow", en, PLATFORM_LANGUAGES)
const fromBuild = () => ({ manifest: FLOW })
const resolveFlow = (raw: unknown, offered: readonly string[] | undefined = undefined) => resolveSurfaceStrings(raw, offered, fromBuild)

const KEY = "credits.allowanceExceeded" // no placeholders
// Whichever key has several placeholders today, so changing one string's placeholders fails nothing here.
const [POSE, POSE_NAMES] = Object.entries(FLOW.keys).find(([, names]) => names.length >= 3) as [string, readonly string[]]
const EN_TEXT = "Your Example Studio allowance is used up. Ask your administrator for more."
const HE_TEXT = "נגמרה לכם המכסה. פנו למנהל המערכת שלכם."

afterEach(() => vi.restoreAllMocks())

function quiet() {
  return vi.spyOn(console, "warn").mockImplementation(() => {})
}

describe("readUiStringManifest — the file the editor's build leaves beside its output", () => {
  const dirs: string[] = []
  const tempDir = () => {
    const dir = mkdtempSync(join(tmpdir(), "ui-strings-manifest-"))
    dirs.push(dir)
    return dir
  }
  const withFile = (text: string) => {
    const dir = tempDir()
    writeFileSync(join(dir, uiStringManifestFile("flow")), text)
    return dir
  }
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it("defaults to the frontend's build output, the same place in a checkout and in the image", () => {
    expect(FRONTEND_BUILD_DIR.replace(/\/+$/, "").endsWith(join("frontend", "dist"))).toBe(true)
  })

  it("reads what the build emits, whole", () => {
    expect(readUiStringManifest("flow", withFile(JSON.stringify(FLOW)))).toEqual({ manifest: FLOW })
  })

  it("validation accepts and rejects against the file it read", () => {
    const warn = quiet()
    const dir = withFile(JSON.stringify(FLOW))
    expect(resolveSurfaceStrings({ flow: { en: { [KEY]: EN_TEXT, "no.such.key": "x" } } }, undefined, (product) => readUiStringManifest(product, dir))).toEqual({
      flow: { en: { [KEY]: EN_TEXT } },
    })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toMatch(/no\.such\.key/)
  })

  it("an absent file: no manifest, and it says so", () => {
    const read = readUiStringManifest("flow", tempDir())
    expect("problem" in read && read.problem).toMatch(/there is no key manifest at .*ui-strings-manifest\.flow\.json \(a local dev run, or a build that did not emit it\)/)
  })

  it("an absent file: every override is dropped with one clear warning, and nothing throws", () => {
    const warn = quiet()
    const dir = tempDir()
    expect(resolveSurfaceStrings({ flow: { en: { [KEY]: EN_TEXT }, he: { [KEY]: HE_TEXT } } }, undefined, (product) => readUiStringManifest(product, dir))).toBeUndefined()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toMatch(/^\[surface-profile\] strings\.flow: every override dropped — there is no key manifest at .*, so none can be checked$/)
  })

  it.each([
    ["not JSON", "{ nope", /not valid JSON/],
    ["JSON that is not a manifest", "[1]", /not a key manifest for flow/],
    ["another product's manifest", JSON.stringify({ ...FLOW, product: "voice" }), /not a key manifest for flow/],
    ["no key list", JSON.stringify({ product: "flow", locales: ["en"] }), /not a key manifest for flow/],
    ["keys that are not name lists", JSON.stringify({ product: "flow", locales: ["en"], keys: { a: "b" } }), /not a key manifest for flow/],
    ["locales that are not a list", JSON.stringify({ product: "flow", locales: "en", keys: {} }), /not a key manifest for flow/],
  ])("%s: treated like an absent file", (_label, text, why) => {
    const read = readUiStringManifest("flow", withFile(text))
    expect("problem" in read && read.problem).toMatch(why)
  })

  it("a directory where the file should be: reported, never thrown", () => {
    const dir = tempDir()
    mkdirSync(join(dir, uiStringManifestFile("flow")))
    const read = readUiStringManifest("flow", dir)
    expect("problem" in read && read.problem).toMatch(/cannot be read \(EISDIR\)/)
  })

  it("with no strings, no manifest is opened; nor for a product that reads none", () => {
    quiet()
    const read = vi.fn(fromBuild)
    expect(resolveSurfaceStrings(undefined, undefined, read)).toBeUndefined()
    expect(resolveSurfaceStrings({ voice: { en: { "x.y": "z" } } }, undefined, read)).toBeUndefined()
    expect(resolveSurfaceStrings("x", undefined, read)).toBeUndefined()
    expect(read).not.toHaveBeenCalled()
  })
})

describe("uiStringTextProblem — plain text, the base placeholders, a sane length", () => {
  it.each([
    ["plain text", EN_TEXT, []],
    ["right-to-left text with marks and an isolate", "\u200F\u200E-1 עד \u2068{n}\u2069", ["n"]],
    ["a line break", "First line\nSecond line", []],
    ["angle brackets that are not HTML", "Reads t.me/s/<channel>", []],
    ["the same placeholders in another order, one twice", "{toPose} {after} {before} {fromPose} {after}", ["after", "before", "fromPose", "toPose"]],
    ["double braces, read the same way on both sides", "Use {{now}} here", ["now"]],
    ["exactly the longest allowed text", "x".repeat(UI_STRING_MAX_LENGTH), []],
  ])("keeps %s", (_label, text, base) => {
    expect(uiStringTextProblem(text, base)).toBeUndefined()
  })

  it.each([
    ["not text", 42, [], /not text/],
    ["blank", "   ", [], /blank/],
    ["too long", "x".repeat(UI_STRING_MAX_LENGTH + 1), [], /1001 characters/],
    ["a tab", "a\tb", [], /control character/],
    ["a carriage return", "a\r\nb", [], /control character/],
    ["a bidi override", "abc\u202Edef", [], /bidi embedding or override/],
    ["an HTML tag", "Call <b>billing</b>", [], /HTML markup \(<b>\)/],
    ["a link", '<a href="mailto:x@example.com">mail</a>', [], /HTML markup \(<a>\)/],
    ["a closing tag alone", "text</span>", [], /HTML markup \(<span>\)/],
    ["a self-closing break", "one<br/>two", [], /HTML markup \(<br>\)/],
    ["an HTML comment", "a <!-- b --> c", [], /<! or <\?/],
    ["a named character reference", "Fish &amp; chips", [], /character reference/],
    ["a numeric character reference", "It&#39;s", [], /character reference/],
    ["a lone surrogate", "bad \uD800 text", [], /lone surrogate/],
    ["a dropped placeholder", "{after} {before} {fromPose}", ["after", "before", "fromPose", "toPose"], /uses placeholders \{after\}, \{before\}, \{fromPose\}, but the base string uses/],
    ["an added placeholder", "Out of credits, {name}", [], /uses placeholders \{name\}, but the base string uses none/],
    ["a renamed placeholder", "{count} left", ["n"], /\{count\}.*\{n\}/],
  ])("refuses %s", (_label, text, base, why) => {
    expect(uiStringTextProblem(text, base)).toMatch(why)
  })
})

describe("resolveSurfaceStrings — drop each bad entry with a warning, keep the rest", () => {
  it("absent stays absent, without a word", () => {
    const warn = quiet()
    expect(resolveFlow(undefined)).toBeUndefined()
    expect(warn).not.toHaveBeenCalled()
  })

  it("keeps valid overrides, in the platform's spelling of each locale", () => {
    const warn = quiet()
    expect(resolveFlow({ flow: { he: { [KEY]: HE_TEXT }, en: { [KEY]: EN_TEXT }, "pt-br": { [KEY]: "Seus créditos acabaram." } } })).toEqual({
      flow: { he: { [KEY]: HE_TEXT }, en: { [KEY]: EN_TEXT }, "pt-BR": { [KEY]: "Seus créditos acabaram." } },
    })
    expect(warn).not.toHaveBeenCalled()
  })

  it("a key the dictionary lacks is dropped alone", () => {
    const warn = quiet()
    expect(resolveFlow({ flow: { en: { [KEY]: EN_TEXT, "credits.noSuchKey": "x" } } })).toEqual({ flow: { en: { [KEY]: EN_TEXT } } })
    expect(warn).toHaveBeenCalledWith('[surface-profile] strings.flow.en."credits.noSuchKey" dropped — is not a key of the flow dictionary')
  })

  it("a grammar-data key (blank in the base dictionary) cannot be overridden", () => {
    const warn = quiet()
    expect(FLOW.keys["org.workspaceWordGender"]).toBeUndefined()
    expect(resolveFlow({ flow: { he: { "org.workspaceWordGender": "m" } } })).toBeUndefined()
    expect(warn.mock.calls[0][0]).toMatch(/org\.workspaceWordGender.*not a key of the flow dictionary/)
  })

  it("a text problem is dropped alone, named with its reason", () => {
    const warn = quiet()
    expect(resolveFlow({ flow: { en: { [KEY]: EN_TEXT, [POSE]: `{${POSE_NAMES[0]}} only` } } })).toEqual({ flow: { en: { [KEY]: EN_TEXT } } })
    expect(String(warn.mock.calls[0][0])).toContain(`[surface-profile] strings.flow.en.${JSON.stringify(POSE)} dropped — uses placeholders {${POSE_NAMES[0]}}, but the base string uses`)
  })

  it("with locale.offered set, only its locales; without it, the locales Flow offers", () => {
    const warn = quiet()
    const raw = { flow: { he: { [KEY]: HE_TEXT }, ja: { [KEY]: "クレジットがありません。" } } }
    expect(resolveFlow(raw, ["he", "en"])).toEqual({ flow: { he: { [KEY]: HE_TEXT } } })
    expect(warn).toHaveBeenCalledWith("[surface-profile] strings.flow.ja dropped — ja is not offered (locale.offered: he, en)")
    warn.mockClear()
    expect(resolveFlow(raw)).toEqual(raw)
    expect(resolveFlow({ flow: { de: { [KEY]: "Keine Credits mehr." } } })).toBeUndefined()
    expect(warn).toHaveBeenCalledWith("[surface-profile] strings.flow.de dropped — de is not offered (flow offers: en, he, ja, ko, pt-BR)")
  })

  it("an unknown locale, a second spelling of one, and a non-object block are each dropped", () => {
    const warn = quiet()
    expect(resolveFlow({ flow: { xx: { [KEY]: EN_TEXT }, "pt-BR": { [KEY]: "Um." }, "pt-br": { [KEY]: "Dois." }, en: "nope" } })).toEqual({
      flow: { "pt-BR": { [KEY]: "Um." } },
    })
    expect(warn.mock.calls.map((c) => c[0])).toEqual([
      '[surface-profile] strings.flow.xx dropped — "xx" is not a locale id',
      "[surface-profile] strings.flow.pt-br dropped — pt-BR is already given under another spelling",
      '[surface-profile] strings.flow.en dropped — must be an object { "<key>": "text" }',
    ])
  })

  it("a product that reads no overrides is dropped; Flow's beside it stay", () => {
    const warn = quiet()
    expect(resolveFlow({ voice: { en: { "x.y": "z" } }, flow: { en: { [KEY]: EN_TEXT } } })).toEqual({ flow: { en: { [KEY]: EN_TEXT } } })
    expect(warn).toHaveBeenCalledWith('[surface-profile] strings.voice dropped — "voice" is not a product that reads overrides (known: flow)')
  })

  it.each([["a string", "x"], ["an array", [1]], ["null", null], ["a number", 7]])("strings as %s is ignored, loudly", (_label, raw) => {
    const warn = quiet()
    expect(resolveFlow(raw)).toBeUndefined()
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it("never throws on any JSON shape", () => {
    quiet()
    const shapes = [{}, { flow: null }, { flow: [] }, { flow: { en: [] } }, { flow: { en: { [KEY]: null } } }, { flow: { en: { [KEY]: { nested: 1 } } } }, { "": { "": { "": "" } } }]
    for (const raw of shapes) expect(() => resolveFlow(raw)).not.toThrow()
    expect(resolveFlow(JSON.parse('{"flow":{"__proto__":{"x":"y"},"en":{"__proto__":"z"}}}'))).toBeUndefined()
  })

  it("one product's text over the byte budget is dropped as a whole", () => {
    const warn = quiet()
    const plainKeys = Object.entries(FLOW.keys).filter(([, names]) => names.length === 0).map(([key]) => key)
    const fill = (n: number) => Object.fromEntries(plainKeys.slice(0, n).map((key) => [key, "x".repeat(UI_STRING_MAX_LENGTH)]))
    const fits = Math.floor(UI_STRINGS_MAX_BYTES / UI_STRING_MAX_LENGTH)
    expect(Object.keys(resolveFlow({ flow: { en: fill(fits) } })?.flow.en ?? {})).toHaveLength(fits)
    expect(warn).not.toHaveBeenCalled()
    expect(resolveFlow({ flow: { en: fill(fits + 1) } })).toBeUndefined()
    expect(warn.mock.calls[0][0]).toMatch(/strings\.flow dropped — \d+ bytes of text is over the 65536-byte limit/)
  })

  it("lists the first 20 problems one by one and sums up the rest", () => {
    const warn = quiet()
    const bad = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`no.such.key${i}`, "x"]))
    expect(resolveFlow({ flow: { en: bad } })).toBeUndefined()
    expect(warn).toHaveBeenCalledTimes(21)
    expect(warn.mock.calls[20][0]).toBe("[surface-profile] strings: 10 more problems not shown")
  })

  it("keeps the text verbatim (no trimming: a leading space can be deliberate)", () => {
    quiet()
    expect(resolveFlow({ flow: { en: { [KEY]: ` ${EN_TEXT} ` } } })).toEqual({ flow: { en: { [KEY]: ` ${EN_TEXT} ` } } })
  })
})
