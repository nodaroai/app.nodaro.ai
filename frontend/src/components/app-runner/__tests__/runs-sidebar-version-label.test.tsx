import { describe, it, expect, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { useLocaleStore } from "@/lib/locale-store"
import type { LocaleId } from "@nodaro/shared"
import { RunsSidebar } from "../runs-sidebar"

/**
 * The version picker marks the latest version through `common.qualified`, so
 * each language decides how a qualifier attaches: Korean puts no space before
 * the parenthesis, Japanese uses full-width parentheses.
 */

const noop = () => {}

function versionOptions(locale: LocaleId): string[] {
  useLocaleStore.setState({ locale })
  render(
    <MemoryRouter>
      <RunsSidebar
        slots={[]}
        activeSlotId={null}
        onSelectSlot={noop}
        onCreateNew={noop}
        onDuplicateSlot={noop}
        onDeleteSlot={noop}
        onRenameSlot={noop}
        onClose={noop}
        versions={[
          { version: 3, id: "v3", createdAt: "2026-09-01T00:00:00Z" },
          { version: 2, id: "v2", createdAt: "2026-08-01T00:00:00Z" },
        ]}
        selectedVersion={null}
        onSelectVersion={noop}
        latestVersion={3}
      />
    </MemoryRouter>,
  )
  // The first option is "Latest (v3)", which follows the newest version.
  return screen.getAllByRole("option").slice(1).map((o) => o.textContent ?? "")
}

beforeEach(() => {
  useLocaleStore.setState({ locale: "en" })
})

describe("RunsSidebar — version options", () => {
  it.each([
    ["en", ["v3 (latest)", "v2"]],
    ["he", ["v3 (אחרונה)", "v2"]],
    ["ja", ["v3（最新）", "v2"]],
    ["ko", ["v3(최신)", "v2"]],
  ] as const)("%s", (locale, expected) => {
    expect(versionOptions(locale)).toEqual(expected)
  })
})
