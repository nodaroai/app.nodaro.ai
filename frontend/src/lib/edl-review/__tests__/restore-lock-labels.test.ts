import { describe, it, expect } from "vitest"
import { translate } from "@/lib/i18n"
import { restoreLockLabel } from "../restore-lock-labels"

const CODES = ["structural", "output-cap", "unknown-role", "missing-url", "no-picture", "layout", "region", "reads-before-source"]

describe("restoreLockLabel", () => {
  it("names every check of the render rule in the reviewer's words", () => {
    expect(restoreLockLabel("reads-before-source")).toBe("no camera filmed this")
    for (const code of CODES) expect(restoreLockLabel(code)).not.toBe(code)
  })

  it("is translated in every complete locale", () => {
    const t = (key: Parameters<typeof translate>[1]) => translate("he", key)
    for (const code of CODES) expect(restoreLockLabel(code, t)).toMatch(/[֐-׿]/)
  })

  it("shows a check it does not know as written", () => {
    expect(restoreLockLabel("future-check")).toBe("future-check")
  })
})
