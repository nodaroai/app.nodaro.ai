/**
 * Suno Separate's panel: the three modes, the instrument picker of
 * one-instrument mode (KIE's names, verbatim), the "If Suno refuses, use
 * Demucs" switch (no fallback for one instrument), every stem a full-stems run
 * returned, and both takes of a one-instrument run.
 */
import { createContext } from "react"
import { describe, it, expect, vi } from "vitest"
import { render, screen, within } from "@testing-library/react"
import { SUNO_SEPARATE_TYPES, SUNO_STEM_NAMES } from "@nodaro/shared/models"

vi.mock("@/components/ui/select", () => ({
  MappableFieldCtx: createContext<unknown>(null),
  Select: ({ children, value, disabled }: any) => <div data-testid="select" data-value={value} data-disabled={disabled ? "true" : undefined}>{children}</div>,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children, value }: any) => <option value={value}>{children}</option>,
  SelectTrigger: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  SelectValue: () => <span />,
}))
vi.mock("@/components/ui/switch", () => ({
  Switch: ({ checked, disabled, onCheckedChange, ...p }: any) => (
    <input type="checkbox" role="switch" checked={!!checked} disabled={disabled} onChange={(e) => onCheckedChange?.(e.target.checked)} {...p} />
  ),
}))
vi.mock("@/components/ui/input", () => ({ Input: (props: any) => <input {...props} /> }))
vi.mock("@/components/ui/label", () => ({ Label: ({ children, ...p }: any) => <label {...p}>{children}</label> }))
vi.mock("@/components/ui/checkbox", () => ({ Checkbox: () => <input type="checkbox" /> }))
vi.mock("@/components/ui/button", () => ({ Button: ({ children, ...p }: any) => <button {...p}>{children}</button> }))
vi.mock("@/components/audio-player", () => ({
  WaveformAudioPlayer: ({ url }: any) => <div data-testid="player" data-url={url} />,
}))
vi.mock("@/hooks/queries/use-prompt-snippets-queries", () => ({ useSnippetPool: () => [] }))

import { SunoSeparateConfig } from "../audio-configs"

const base = { label: "Suno Separate", type: "separate_vocal", taskId: "", audioId: "" }
function renderPanel(data: Record<string, unknown>, graph: { nodes?: unknown[]; edges?: unknown[] } = {}) {
  return render(
    <SunoSeparateConfig
      data={{ ...base, ...data } as any}
      onUpdate={() => {}}
      nodeId="sep"
      nodes={(graph.nodes ?? []) as any}
      edges={(graph.edges ?? []) as any}
      {...({} as any)}
    />,
  )
}

function selectLabelled(label: string): HTMLElement {
  const found = screen.getAllByTestId("select").find((s) => s.querySelector(`[aria-label="${label}"]`))
  if (!found) throw new Error(`no select labelled ${label}`)
  return found
}
const players = () => screen.queryAllByTestId("player").map((p) => p.getAttribute("data-url"))

describe("SunoSeparateConfig", () => {
  it("offers the three modes, one instrument last", () => {
    renderPanel({})
    const modes = [...selectLabelled("Separation Type").querySelectorAll("option")]
    expect(modes.map((o) => o.getAttribute("value"))).toEqual([...SUNO_SEPARATE_TYPES])
    expect(modes[2]).toHaveTextContent("One instrument")
  })

  it("config: one-instrument shows the stem select defaulting to Lead Vocal and disables the fallback switch", () => {
    renderPanel({ type: "split_stem_advanced", fallbackToDemucs: false })
    const stem = selectLabelled("Instrument")
    expect(stem).toHaveAttribute("data-value", "Lead Vocal")
    const names = [...stem.querySelectorAll("option")].map((o) => o.textContent)
    expect(names).toEqual([...SUNO_STEM_NAMES])
    expect(screen.getByRole("switch", { name: "If Suno refuses, use Demucs" })).toBeDisabled()
  })

  it("other modes hide the instrument picker and enable the fallback switch", () => {
    renderPanel({ type: "split_stem", fallbackToDemucs: true })
    expect(screen.getAllByTestId("select").some((s) => s.querySelector('[aria-label="Instrument"]'))).toBe(false)
    const sw = screen.getByRole("switch", { name: "If Suno refuses, use Demucs" })
    expect(sw).toBeEnabled()
    expect(sw).toBeChecked()
  })

  it("config: stems list renders backing vocals from flat fields", () => {
    renderPanel({
      type: "split_stem",
      vocalUrl: "https://cdn.test/v.mp3",
      instrumentalUrl: "https://cdn.test/i.mp3",
      backingVocalsUrl: "https://cdn.test/bv.mp3",
      drumsUrl: "https://cdn.test/d.mp3",
      otherUrl: "https://cdn.test/o.mp3",
    })
    const list = screen.getByTestId("suno-separate-stems")
    expect(within(list).getByText("Backing vocals")).toBeInTheDocument()
    expect(within(list).getByText("Drums")).toBeInTheDocument()
    expect(within(list).getByText("Other")).toBeInTheDocument()
    // Vocals / instrumental have their own players above; the list does not repeat them.
    const listed = within(list).getAllByTestId("player").map((p) => p.getAttribute("data-url"))
    expect(listed).toEqual(["https://cdn.test/bv.mp3", "https://cdn.test/d.mp3", "https://cdn.test/o.mp3"])
    expect(players().filter((u) => u === "https://cdn.test/v.mp3")).toHaveLength(1)
  })

  it("still renders an old saved stems record", () => {
    renderPanel({ type: "split_stem", stems: { bass_guitar: "https://cdn.test/old-bass.mp3" } })
    expect(players()).toContain("https://cdn.test/old-bass.mp3")
  })

  it("config: take 2 players render when isolated2Url is set", () => {
    renderPanel({
      type: "split_stem_advanced",
      isolatedUrl: "https://cdn.test/iso1.mp3",
      withoutUrl: "https://cdn.test/wo1.mp3",
      isolated2Url: "https://cdn.test/iso2.mp3",
      without2Url: "https://cdn.test/wo2.mp3",
    })
    expect(screen.getByText("Take 1")).toBeInTheDocument()
    expect(screen.getByText("Take 2")).toBeInTheDocument()
    expect(players()).toEqual(expect.arrayContaining([
      "https://cdn.test/iso1.mp3", "https://cdn.test/wo1.mp3", "https://cdn.test/iso2.mp3", "https://cdn.test/wo2.mp3",
    ]))
  })

  it("no take 2 without its URLs", () => {
    renderPanel({ type: "split_stem_advanced", isolatedUrl: "https://cdn.test/iso1.mp3", withoutUrl: "https://cdn.test/wo1.mp3" })
    expect(screen.getByText("Take 1")).toBeInTheDocument()
    expect(screen.queryByText("Take 2")).toBeNull()
  })

  it("hides the Suno id fields when other audio is wired and no ids are known; shows them unconnected", () => {
    const nodes = [
      { id: "up", type: "audio-upload", data: { label: "Song", audioUrl: "https://cdn/song.mp3" } },
      { id: "sep", type: "suno-separate", data: base },
    ]
    const { unmount } = renderPanel({}, { nodes, edges: [{ id: "e", source: "up", target: "sep" }] })
    expect(screen.queryByText("Task ID")).toBeNull()
    unmount()
    renderPanel({}, { nodes, edges: [] })
    expect(screen.getByText("Task ID")).toBeInTheDocument()
  })

  it("keeps the Suno id fields for a wired Suno source that has not run yet", () => {
    const nodes = [
      { id: "gen", type: "suno-generate", data: { label: "Suno Generate" } },
      { id: "sep", type: "suno-separate", data: base },
    ]
    renderPanel({}, { nodes, edges: [{ id: "e", source: "gen", target: "sep" }] })
    expect(screen.getByText("Task ID")).toBeInTheDocument()
  })
})
