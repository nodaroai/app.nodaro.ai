/**
 * The template gallery's "cheapest first" sort orders by the price of a
 * typical episode (decided 2026-10-07): fixed + TYPICAL_EPISODE_MINUTES x the
 * per-minute price. The sort option's tooltip states that length, in every
 * locale, from the same constant the server's sort column is generated from.
 */
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { TYPICAL_EPISODE_MINUTES } from "@nodaro/render-rules"
import { SegmentedControl } from "../home-section"
import { en } from "@/lib/i18n/en"
import { he } from "@/lib/i18n/he"
import { ja } from "@/lib/i18n/ja"
import { ko } from "@/lib/i18n/ko"
import { ptBR } from "@/lib/i18n/pt-br"

describe("the cheapest-first tooltip", () => {
  it.each([["en", en], ["he", he], ["ja", ja], ["ko", ko], ["pt-br", ptBR]] as const)("%s states the episode length", (_locale, dict) => {
    const hint = (dict as Record<string, string | undefined>)["templates.sortCheapestHint"]
    expect(hint).toBeDefined()
    expect(hint).toContain("{n}")
  })

  it("an option's hint is its tooltip", () => {
    render(
      <SegmentedControl
        label="Sort"
        value="cheapest"
        onChange={() => {}}
        options={[{ value: "cheapest", label: "Fewest credits", hint: `a ${TYPICAL_EPISODE_MINUTES}-minute recording` }]}
      />,
    )
    expect(screen.getByRole("button", { name: "Fewest credits" }).getAttribute("title")).toBe("a 60-minute recording")
  })
})
