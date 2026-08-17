import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { JobSourceBadge } from "../job-source-badge"

const APP_ID = "cbc84cf8-c117-4675-b431-401151817abe"

describe("JobSourceBadge", () => {
  it("shows the resolved app name instead of the raw id for app jobs", () => {
    render(<JobSourceBadge source="app" sourceDetail={APP_ID} appName="Claude" />)
    expect(screen.getByText("Claude")).toBeInTheDocument()
    expect(screen.queryByText(APP_ID)).not.toBeInTheDocument()
    // The id must survive on hover — it is the only stable identity (names
    // are non-unique and the app row can be deleted later).
    expect(screen.getByTitle(`App · Claude · ${APP_ID}`)).toBeInTheDocument()
  })

  it("falls back to the raw id when the app name is unresolved (deleted app)", () => {
    render(<JobSourceBadge source="app" sourceDetail={APP_ID} appName={null} />)
    expect(screen.getByText(APP_ID)).toBeInTheDocument()
    expect(screen.getByTitle(`App · ${APP_ID}`)).toBeInTheDocument()
  })

  it("ignores appName for non-app sources", () => {
    render(<JobSourceBadge source="mcp" sourceDetail="claude-code" appName="ShouldNotShow" />)
    expect(screen.getByText("claude-code")).toBeInTheDocument()
    expect(screen.queryByText("ShouldNotShow")).not.toBeInTheDocument()
  })

  it("renders an em-dash with an honest tooltip when no source was recorded", () => {
    render(<JobSourceBadge source={null} />)
    const dash = screen.getByText("—")
    expect(dash).toHaveAttribute("title", expect.stringContaining("No source recorded"))
  })

  it("renders the Workflow badge alongside the source badge", () => {
    render(<JobSourceBadge source="web" sourceDetail="app.nodaro.ai" workflowExecutionId="392b317d" />)
    expect(screen.getByText("Web")).toBeInTheDocument()
    expect(screen.getByText("Workflow")).toBeInTheDocument()
  })
})
