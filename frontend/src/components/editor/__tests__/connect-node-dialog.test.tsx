import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { ConnectNodeDialog } from "../connect-node-dialog"
import type { ConnectionOptions, ConnectionOption } from "@/lib/enumerate-connection-options"

function handle(partial: Partial<ConnectionOption>): ConnectionOption {
  return { kind: "handle", direction: "target", fHandle: "prompt", nHandle: "prompt", tier: "direct", label: "Prompt", color: "#3B82F6", ...partial }
}

const baseOptions: ConnectionOptions = {
  handles: [handle({ label: "Prompt", fHandle: "prompt" }), handle({ label: "Negative", fHandle: "negative" })],
  variables: [],
}

function renderDialog(options: ConnectionOptions, overrides: Partial<Parameters<typeof ConnectNodeDialog>[0]> = {}) {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()
  render(
    <ConnectNodeDialog
      focusedLabel="Hero Shot"
      newLabel="Text"
      options={options}
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...overrides}
    />,
  )
  return { onConfirm, onCancel }
}

describe("ConnectNodeDialog", () => {
  it("renders a row per handle option", () => {
    renderDialog(baseOptions)
    expect(screen.getByText("Prompt")).toBeInTheDocument()
    expect(screen.getByText("Negative")).toBeInTheDocument()
    expect(screen.getByText("Don’t connect (just add)")).toBeInTheDocument()
  })

  it("navigating to a variable row fills the name input with the variable name", () => {
    renderDialog({
      handles: baseOptions.handles,
      variables: [{ ...handle({}), kind: "variable", variableName: "Hero", label: "Hero" }],
    })
    const dialog = screen.getByRole("dialog")
    // default highlight = handle 0; ArrowDown twice → variable row (index 2).
    fireEvent.keyDown(dialog, { key: "ArrowDown" })
    fireEvent.keyDown(dialog, { key: "ArrowDown" })
    expect((screen.getByLabelText("Node name") as HTMLInputElement).value).toBe("Hero")
  })

  it("Enter confirms the default-highlighted handle with the current name", () => {
    const { onConfirm } = renderDialog(baseOptions)
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter" })
    expect(onConfirm).toHaveBeenCalledTimes(1)
    const arg = onConfirm.mock.calls[0][0]
    expect(arg.option?.fHandle).toBe("prompt")
    expect(arg.name).toBe("Text")
  })

  it("Esc calls onCancel", () => {
    const { onCancel } = renderDialog(baseOptions)
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it("Don't connect confirms with a null option", () => {
    const { onConfirm } = renderDialog(baseOptions)
    fireEvent.click(screen.getByText("Don’t connect (just add)"))
    expect(onConfirm).toHaveBeenCalledWith({ option: null, name: "Text" })
  })

  it("clicking a variable row confirms with the variable name as the node name", () => {
    const { onConfirm } = renderDialog({
      handles: baseOptions.handles,
      variables: [{ ...handle({}), kind: "variable", variableName: "Hero", label: "Hero" }],
    })
    fireEvent.click(screen.getByText("{Hero}"))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onConfirm.mock.calls[0][0].name).toBe("Hero")
    expect(onConfirm.mock.calls[0][0].option.variableName).toBe("Hero")
  })
})
