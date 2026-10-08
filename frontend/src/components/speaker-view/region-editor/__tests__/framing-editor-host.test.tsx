// The region editor's ways in (U4): `?framing=<nodeId>` opens it on a Speaker
// View node once the workflow has loaded, the panel's "Edit framing…" opens it
// through the store and writes the param, and closing removes it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter, useLocation } from "react-router-dom"

vi.mock("../region-editor-dialog", () => ({
  RegionEditorDialog: (p: { nodeId: string; label: string; onClose: () => void }) => (
    <div data-testid="framing" data-node={p.nodeId} data-label={p.label}>
      <button onClick={p.onClose}>close</button>
    </div>
  ),
}))

const toasts = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn() }))
vi.mock("sonner", () => ({ toast: toasts }))

import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { tx } from "@/lib/i18n"
import { openFraming, useFramingOpenStore } from "@/hooks/use-framing-open-store"
import { FramingEditorHost } from "../framing-editor-host"
import { SpeakerViewFramingSummary } from "@/components/editor/config-panels/speaker-view-framing-summary"

const search = { current: "" }
function Probe() {
  search.current = useLocation().search
  return null
}
const mountAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <FramingEditorHost />
      <SpeakerViewFramingSummary regions={undefined} nodeId="sv" />
      <Probe />
    </MemoryRouter>,
  )

beforeEach(() => {
  toasts.info.mockClear()
  search.current = ""
  useWorkflowStore.setState({
    nodes: [
      { id: "sv", type: "speaker-view", position: { x: 0, y: 0 }, data: { label: "Speaker View 2" } },
      { id: "cs", type: "camera-switch", position: { x: 0, y: 0 }, data: { label: "Camera Switch" } },
    ],
    edges: [],
    isWorkflowLoading: false,
    isReadOnly: false,
    workflowId: null,
  } as never)
})
afterEach(() => {
  cleanup()
  useFramingOpenStore.setState({ nodeId: null, hostMounted: false })
})

describe("?framing=", () => {
  it("opens the editor on the Speaker View node it names, titled with its label", async () => {
    mountAt("/editor?framing=sv")
    const dialog = await screen.findByTestId("framing")
    expect(dialog.dataset.node).toBe("sv")
    expect(dialog.dataset.label).toBe("Speaker View 2")
  })

  it("an id that is not a Speaker View node is dropped with one toast, the other params kept", async () => {
    mountAt("/editor?focusType=x&framing=cs")
    await waitFor(() => expect(search.current).toBe("?focusType=x"))
    expect(screen.queryByTestId("framing")).toBeNull()
    expect(toasts.info).toHaveBeenCalledTimes(1)
  })

  it("on a read-only workflow the link does not open an editor that cannot save: one toast, the param dropped", async () => {
    useWorkflowStore.setState({ isReadOnly: true } as never)
    mountAt("/editor?focusType=x&framing=sv")
    await waitFor(() => expect(search.current).toBe("?focusType=x"))
    expect(screen.queryByTestId("framing")).toBeNull()
    expect(toasts.info).toHaveBeenCalledTimes(1)
    expect(toasts.info).toHaveBeenCalledWith(tx("speakerView.framing.linkReadOnly"), expect.anything())
  })

  it("closing removes the param", async () => {
    mountAt("/editor?framing=sv")
    fireEvent.click(await screen.findByText("close"))
    await waitFor(() => expect(search.current).toBe(""))
    expect(screen.queryByTestId("framing")).toBeNull()
  })
})

describe("Edit framing…", () => {
  it("opens the editor from the panel and writes the param", async () => {
    mountAt("/editor")
    fireEvent.click(await screen.findByTestId("speaker-view-edit-framing"))
    expect((await screen.findByTestId("framing")).dataset.node).toBe("sv")
    await waitFor(() => expect(search.current).toBe("?framing=sv"))
  })

  it("is not offered where no editor can open (no host mounted)", () => {
    render(<SpeakerViewFramingSummary regions={[{}, {}]} nodeId="sv" />)
    expect(screen.queryByTestId("speaker-view-edit-framing")).toBeNull()
  })

  it("openFraming is a no-op without a host", () => {
    act(() => openFraming("sv"))
    expect(useFramingOpenStore.getState().nodeId).toBeNull()
  })
})
