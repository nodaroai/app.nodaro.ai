/**
 * Instagram's Post link mode: the panel asks for post links, and the settings
 * that cannot apply to a named post (posts per source, period, format filter)
 * are not offered — the route ignores them in post mode anyway.
 */
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { InstagramScrapeConfig } from "../instagram-configs"
import { en } from "@/lib/i18n/en"
import type { InstagramScrapeNodeData } from "@/types/nodes"

vi.mock("@/components/editor/save-to-library-button", () => ({ SaveToLibraryButton: () => null }))
vi.mock("../llm-model-select", () => ({ LlmModelSelect: () => null }))

function renderConfig(mode: string, onUpdate: (patch: Partial<InstagramScrapeNodeData>) => void = () => {}) {
  const data = { label: "Instagram", mode, targets: "" } as unknown as InstagramScrapeNodeData
  return render(
    <InstagramScrapeConfig data={data} onUpdate={onUpdate} sources={[]} fieldMappings={{}} onMapField={() => {}} nodes={[]} />,
  )
}

describe("Instagram config — Post link mode", () => {
  it("asks for post links and hides count, period and format filter", () => {
    renderConfig("post")
    expect(screen.getByPlaceholderText(en["cfgext.igPostsPh"])).toBeInTheDocument()
    expect(screen.getByText(en["cfgext.igPostsHelp"].replace("{max}", "5"))).toBeInTheDocument()
    expect(screen.queryByText(en["cfgext.igPostsPerSource"])).not.toBeInTheDocument()
    expect(screen.queryByText(en["cfgext.igPeriod"])).not.toBeInTheDocument()
    expect(screen.queryByText(en["cfgext.igFormat"])).not.toBeInTheDocument()
  })

  it("keeps every setting in profile mode", () => {
    renderConfig("profile")
    expect(screen.getByPlaceholderText(en["cfgext.igProfilesPh"])).toBeInTheDocument()
    expect(screen.getByText(en["cfgext.igPostsPerSource"])).toBeInTheDocument()
    expect(screen.getByText(en["cfgext.igPeriod"])).toBeInTheDocument()
    expect(screen.getByText(en["cfgext.igFormat"])).toBeInTheDocument()
  })

  it("offers Post link as a third mode", () => {
    const onUpdate = vi.fn()
    renderConfig("profile", onUpdate)
    fireEvent.click(screen.getByRole("button", { name: en["cfgext.igModePost"] }))
    expect(onUpdate).toHaveBeenCalledWith({ mode: "post" })
  })
})
