/**
 * The contract of the one place the entity lists, the library and their MCP
 * tools turn search text into a filter.
 *
 * A search is WORDS: split on whitespace, at most five, and a row is kept only
 * when EVERY word occurs in one of the searched columns, ignoring case — the
 * rule `q` already has on saved posts and collection records, except that
 * punctuation inside a word is matched as written rather than removed.
 *
 * There is no PostgREST in this suite, so the test reads each filter back the
 * way PostgREST does (`readOrFilter`, transcribed from its grammar) and runs
 * the patterns it decodes. That proves two things: every filter parses as
 * exactly one condition per column whatever a word holds, and each pattern
 * matches its word literally — `%`, `_` and `*` included — ignoring case.
 * (The same patterns were run against Postgres itself with `~*` while this was
 * written, and the community smoke probe runs them through a real PostgREST;
 * JavaScript regexes agree with Postgres on every escape used here, because
 * each one is a backslash before a syntax character.)
 */
import { describe, expect, it } from "vitest"
import {
  ASSET_SEARCH_COLUMNS,
  SAVED_ENTITY_SEARCH_COLUMNS,
  SEARCH_MAX_WORDS,
  SEARCH_TEXT_MAX_LENGTH,
  SearchTextError,
  literalRegex,
  normalizeSearchText,
  searchTextParam,
  searchTextProblem,
  searchWords,
  textSearchFilters,
} from "../text-search.js"

/**
 * One `or=(…)` list as PostgREST parses it (`ApiRequest/QueryParams.hs`):
 * each element is `field.operator.value`, a value in double quotes reads a
 * backslash as "take the next character as it is" (`pQuotedValue`), and the
 * quoted value must be followed by `,` or the end (`pLogicSingleVal`).
 */
function readOrFilter(filter: string): Array<{ column: string; op: string; value: string }> {
  const out: Array<{ column: string; op: string; value: string }> = []
  let i = 0
  while (i < filter.length) {
    const columnEnd = filter.indexOf(".", i)
    const opEnd = filter.indexOf(".", columnEnd + 1)
    if (columnEnd < 0 || opEnd < 0) throw new Error(`no field.operator at ${i}`)
    let j = opEnd + 1
    if (filter[j] !== '"') throw new Error(`unquoted value at ${j}`)
    j += 1
    let value = ""
    while (j < filter.length && filter[j] !== '"') {
      if (filter[j] === "\\") j += 1
      if (j >= filter.length) throw new Error("a backslash ends the value")
      value += filter[j]
      j += 1
    }
    if (filter[j] !== '"') throw new Error("unterminated quoted value")
    j += 1
    if (j < filter.length && filter[j] !== ",") throw new Error(`"${filter[j]}" after a quoted value`)
    out.push({ column: filter.slice(i, columnEnd), op: filter.slice(columnEnd + 1, opEnd), value })
    i = j + 1
  }
  return out
}

/**
 * Whether a row is kept, as PostgREST would run the filters: each filter is an
 * `or=` (any column matches, `~*`), and separate `or=` parameters are ANDed.
 */
function keeps(row: Record<string, string>, text: string, columns: readonly string[] = ["name"]): boolean {
  return textSearchFilters(columns, text).every((filter) =>
    readOrFilter(filter).some((c) => new RegExp(c.value, "iu").test(row[c.column] ?? "")),
  )
}
const named = (name: string) => ({ name })

describe("textSearchFilters", () => {
  it("is one filter per word, each a case-insensitive regex condition per column", () => {
    expect(textSearchFilters(SAVED_ENTITY_SEARCH_COLUMNS, "Maya")).toEqual(['name.imatch."Maya",description.imatch."Maya"'])
    expect(textSearchFilters(SAVED_ENTITY_SEARCH_COLUMNS, "red  car")).toEqual([
      'name.imatch."red",description.imatch."red"',
      'name.imatch."car",description.imatch."car"',
    ])
  })

  it("pins the wire form of wildcards, punctuation, quotes and backslashes inside a word", () => {
    expect(textSearchFilters(["name"], "100%_x*")).toEqual([String.raw`name.imatch."100%_x\\*"`])
    expect(textSearchFilters(["filename"], "Smith, John (2).png")).toEqual([
      'filename.imatch."Smith,"',
      'filename.imatch."John"',
      String.raw`filename.imatch."\\(2\\)\\.png"`,
    ])
    expect(textSearchFilters(["name"], 'say "hi"')).toEqual(['name.imatch."say"', String.raw`name.imatch."\"hi\""`])
    expect(textSearchFilters(["name"], String.raw`a\b`)).toEqual([String.raw`name.imatch."a\\\\b"`])
  })

  it("parses as exactly one condition per column, whatever a word holds", () => {
    const words = ["Smith,", "a),name.eq.x", '"),or(id.eq.1', "{1,2}", String.raw`\",\\`, "a.b.c", "מאיה,"]
    for (const word of words) {
      const [filter, ...rest] = textSearchFilters(SAVED_ENTITY_SEARCH_COLUMNS, word)
      expect(rest, word).toEqual([])
      const conditions = readOrFilter(filter!)
      expect(conditions.map((c) => [c.column, c.op]), word).toEqual([
        ["name", "imatch"],
        ["description", "imatch"],
      ])
      for (const c of conditions) expect(c.value, word).toBe(literalRegex(word))
    }
  })

  it("keeps a row only when every word occurs, in any order and any column", () => {
    expect(keeps(named("Red car, fast"), "car red")).toBe(true)
    expect(keeps(named("Red bus"), "car red")).toBe(false)
    const both = ["name", "description"] as const
    expect(keeps({ name: "Maya", description: "the lead, a pilot" }, "maya pilot", both)).toBe(true)
    expect(keeps({ name: "Maya", description: "the lead" }, "maya pilot", both)).toBe(false)
  })

  it("ignores case", () => {
    expect(keeps(named("Maya Cohen"), "maya")).toBe(true)
    expect(keeps(named("maya cohen"), "MAYA C")).toBe(true)
    expect(keeps(named("Maya Cohen"), "Mayan")).toBe(false)
  })

  it("matches punctuation inside a word as written, never removing it", () => {
    expect(keeps(named("Smith, John"), "Smith, John")).toBe(true)
    expect(keeps(named("John Smith"), "Smith, John")).toBe(false)
    expect(keeps(named("Dr. Who"), "dr.")).toBe(true)
    expect(keeps(named("Dr Who"), "dr.")).toBe(false)
  })

  it("matches the wildcards of LIKE and of PostgREST literally", () => {
    expect(keeps(named("100% Pure"), "100%")).toBe(true)
    expect(keeps(named("1000 Pure"), "100%")).toBe(false)
    expect(keeps(named("a_b"), "a_b")).toBe(true)
    expect(keeps(named("axb"), "a_b")).toBe(false)
    // `*` is the one PostgREST turns into `%` inside like/ilike — the reason
    // the operator is a regex.
    expect(keeps(named("a*b"), "a*b")).toBe(true)
    expect(keeps(named("aXXb"), "a*b")).toBe(false)
  })

  it("matches every printable ASCII character except the space (which splits words) as itself", () => {
    for (let code = 0x21; code <= 0x7e; code += 1) {
      const ch = String.fromCharCode(code)
      const other = ch === "Q" || ch === "q" ? "R" : "Q"
      expect(keeps(named(`zzA${ch}Bzz`), `a${ch}b`), JSON.stringify(ch)).toBe(true)
      expect(keeps(named(`zzA${other}Bzz`), `a${ch}b`), JSON.stringify(ch)).toBe(false)
      expect(keeps(named("zzABzz"), `a${ch}b`), JSON.stringify(ch)).toBe(false)
    }
  })

  it("finds Hebrew text", () => {
    expect(keeps(named("מאיה כהן"), "כהן")).toBe(true)
    expect(keeps(named("מאיה כהן"), "לוי")).toBe(false)
  })

  it(`searches the first ${SEARCH_MAX_WORDS} words and no more`, () => {
    const filters = textSearchFilters(["name"], "a b c d e f g")
    expect(filters).toHaveLength(SEARCH_MAX_WORDS)
    expect(filters.join()).not.toMatch(/"[fg]"/)
  })

  it("reads blank text as no search: no filter at all", () => {
    expect(textSearchFilters(SAVED_ENTITY_SEARCH_COLUMNS, " \t\n ")).toEqual([])
    expect(textSearchFilters(SAVED_ENTITY_SEARCH_COLUMNS, "")).toEqual([])
    expect(textSearchFilters(SAVED_ENTITY_SEARCH_COLUMNS, undefined)).toEqual([])
    expect(textSearchFilters(SAVED_ENTITY_SEARCH_COLUMNS, null)).toEqual([])
  })

  it("refuses a NUL or an over-long text itself, so neither can reach PostgREST from any caller", () => {
    expect(() => textSearchFilters(["name"], "a\u0000b")).toThrow(SearchTextError)
    expect(() => textSearchFilters(["name"], "a".repeat(SEARCH_TEXT_MAX_LENGTH + 1))).toThrow(SearchTextError)
    expect(() => textSearchFilters(["name"], "a\u0000b")).toThrow(searchTextProblem("a\u0000b")!)
  })

  it("refuses an empty column list — a filter over nothing would match nothing", () => {
    expect(() => textSearchFilters([], "maya")).toThrow()
  })
})

describe("searchWords", () => {
  it("splits on any whitespace and keeps everything else", () => {
    expect(searchWords("  red\tcar,\nfast  ")).toEqual(["red", "car,", "fast"])
    expect(searchWords("a*b")).toEqual(["a*b"])
  })
})

describe("literalRegex", () => {
  it("escapes every regex metacharacter and nothing else", () => {
    expect(literalRegex(String.raw`\^$.|?*+()[]{}`)).toBe(String.raw`\\\^\$\.\|\?\*\+\(\)\[\]\{\}`)
    expect(literalRegex("Maya 100%_-#:/'\"")).toBe("Maya 100%_-#:/'\"")
    expect(literalRegex("מאיה")).toBe("מאיה")
  })
})

describe("normalizeSearchText", () => {
  it("trims, and treats blank as no search", () => {
    expect(normalizeSearchText("  Maya \n")).toBe("Maya")
    expect(normalizeSearchText(" \t ")).toBeUndefined()
    expect(normalizeSearchText(undefined)).toBeUndefined()
    expect(normalizeSearchText(null)).toBeUndefined()
  })
})

describe("searchTextParam", () => {
  it("trims, and reads blank as no search rather than an error", () => {
    expect(searchTextParam.parse("  Maya ")).toBe("Maya")
    expect(searchTextParam.parse("   ")).toBeUndefined()
    expect(searchTextParam.parse(undefined)).toBeUndefined()
  })

  it(`allows ${SEARCH_TEXT_MAX_LENGTH} characters after trimming, and no more`, () => {
    expect(searchTextParam.parse(`  ${"a".repeat(SEARCH_TEXT_MAX_LENGTH)}  `)).toHaveLength(SEARCH_TEXT_MAX_LENGTH)
    expect(searchTextParam.safeParse("a".repeat(SEARCH_TEXT_MAX_LENGTH + 1)).success).toBe(false)
  })

  it("refuses a NUL with the helper's own message — one rule, two callers", () => {
    const result = searchTextParam.safeParse("a\u0000b")
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe(searchTextProblem("a\u0000b"))
  })

  it("refuses a repeated parameter (an array)", () => {
    expect(searchTextParam.safeParse(["a", "b"]).success).toBe(false)
  })
})

describe("the searchable columns", () => {
  it("are the name and the user's description for a saved entity, never the generated caption", () => {
    expect([...SAVED_ENTITY_SEARCH_COLUMNS]).toEqual(["name", "description"])
  })

  it("are the filename for a media asset", () => {
    expect([...ASSET_SEARCH_COLUMNS]).toEqual(["filename"])
  })
})
