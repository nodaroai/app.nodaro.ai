/**
 * The "Inherited" hint under a Suno consumer's manual id fields (#819): a
 * wired node must read as configured, and the wording must state the
 * precedence the run applies (connection first, manual only without one).
 */
import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { SunoInheritedHint } from "../audio-configs"

describe("SunoInheritedHint", () => {
  it("renders nothing without an inherited id", () => {
    const { container } = render(<SunoInheritedHint what="track" inherited={undefined} />)
    expect(container).toBeEmptyDOMElement()
  })

  it("names the inherited id and its source, and says nothing needs pasting", () => {
    render(<SunoInheritedHint what="track" inherited="trk-2" sourceLabel="Suno Generate" />)
    const hint = screen.getByTestId("suno-inherited-track")
    expect(hint).toHaveAttribute("id", "suno-inherited-track")
    expect(hint).toHaveTextContent("Inherited from Suno Generate: trk-2")
    expect(hint).toHaveTextContent("nothing to paste")
  })

  it("with a manual value typed, states that the connection takes precedence", () => {
    render(<SunoInheritedHint what="task" manual="typed-task" inherited="task-9" />)
    const hint = screen.getByTestId("suno-inherited-task")
    expect(hint).toHaveTextContent("task id task-9 takes precedence at run time")
    expect(hint).toHaveTextContent("manual value applies only without a connection")
  })
})
