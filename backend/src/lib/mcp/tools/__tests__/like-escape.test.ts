/**
 * The two hazards in a user-supplied `ilike` pattern, neither of which raises.
 *
 * A search that silently matches everything, or a filter that parses as a
 * different filter, both read to the caller as "the tool is broken" — which is
 * exactly the report that led to name search existing at all.
 */
import { describe, expect, it } from "vitest"
import { escapeLikeArgument } from "../_like-escape.js"

describe("escapeLikeArgument", () => {
  it("leaves an ordinary name alone", () => {
    expect(escapeLikeArgument("Alice miller 2")).toBe("Alice miller 2")
  })

  it("escapes the ILIKE wildcards, so a literal % does not match everything", () => {
    expect(escapeLikeArgument("100%")).toBe("100\\%")
    expect(escapeLikeArgument("a_b")).toBe("a\\_b")
  })

  it("escapes a backslash before it can escape something else", () => {
    expect(escapeLikeArgument("a\\b")).toBe("a\\\\b")
  })

  it("neutralises PostgREST's own filter punctuation", () => {
    // A comma does not error — it changes which filters the request is parsed
    // as having, which is the worse failure of the two.
    expect(escapeLikeArgument("Smith, John")).toBe("Smith  John")
    expect(escapeLikeArgument('a(b)c"d.e')).toBe("a b c d e")
  })

  it("is idempotent enough to be safe if it is ever applied twice", () => {
    const once = escapeLikeArgument("Smith, John")
    expect(escapeLikeArgument(once)).toBe(once)
  })

  it("never returns a pattern containing raw grammar characters", () => {
    for (const input of ['%_,."()\\', "George W Pitt", "מאיה", "a".repeat(100)]) {
      const out = escapeLikeArgument(input)
      expect(out).not.toMatch(/[,.()"]/)
      // Every surviving % or _ is preceded by a backslash.
      for (let i = 0; i < out.length; i += 1) {
        if (out[i] === "%" || out[i] === "_") expect(out[i - 1]).toBe("\\")
      }
    }
  })
})
