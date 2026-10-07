import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"

vi.mock("@xyflow/react", () => ({
  applyNodeChanges: vi.fn((_changes, nodes) => nodes),
  applyEdgeChanges: vi.fn((_changes, edges) => edges),
  addEdge: vi.fn((connection, edges) => [...edges, connection]),
}))

import { useEffect } from "react"
import { INSPECTOR_CHILD_DIALOG_Z, INSPECTOR_Z, INSPECTOR_Z_VALUE } from "@/components/inspector/inspector-shell"
import { useRunConfirm } from "@/components/editor/workflow-editor/run-confirm-dialog"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { resetUndoStacks } from "@/lib/edl-review/undo-stack"
import { ReviewInspector } from "../review-inspector"
import { dialog, layOut, loadCanvas } from "./review-test-canvas"

/**
 * Render final and Update preview open the editor's run confirm (and, for an
 * unchanged final, its yes/no question) while the review inspector is open.
 * Both are Radix layers portalled beside the inspector: they must stack above
 * it, or the reviewer gets an invisible dialog that holds every pointer event.
 */
let page: ReturnType<typeof layOut>
beforeEach(() => {
  resetUndoStacks()
  page = layOut()
  loadCanvas()
})
afterEach(() => {
  cleanup()
  page.restore()
  useWorkflowStore.setState({ renderFinal: null })
})

const parseZ = (cls: string): number => {
  const m = cls.match(/z-\[(\d+)\]/)
  if (!m) throw new Error(`expected a z-[N] arbitrary value, got "${cls}"`)
  return Number(m[1])
}

type Ask = "run" | "question"

/** The editor as far as these dialogs go: the real `useRunConfirm`, wired as the store's renderFinal. */
function Editor({ ask, answers }: { readonly ask: Ask; readonly answers: boolean[] }) {
  const { confirmRun, askConfirm, dialog: confirms } = useRunConfirm()
  useEffect(() => {
    useWorkflowStore.setState({
      renderFinal: (_renderId, kind) =>
        (ask === "run"
          ? confirmRun({ trigger: kind === "final" ? "render-final" : "update-preview", nodeCount: 1, estimatedCredits: null, alwaysConfirm: kind === "final" })
          : askConfirm({ title: "Render it again?", body: "Nothing changed.", confirmLabel: "Render again" })
        ).then((v) => {
          answers.push(v)
        }),
    })
  }, [ask, answers, confirmRun, askConfirm])
  return (
    <>
      <ReviewInspector open renderId="cut" onClose={vi.fn()} />
      {confirms}
    </>
  )
}

describe("the run dialogs Render final opens stack above the inspector", () => {
  it("a child dialog's z-index is above the inspector's", () => {
    expect(parseZ(INSPECTOR_Z)).toBe(INSPECTOR_Z_VALUE)
    expect(parseZ(INSPECTOR_CHILD_DIALOG_Z)).toBeGreaterThan(INSPECTOR_Z_VALUE)
  })

  for (const ask of ["run", "question"] as const) {
    it(`the ${ask === "run" ? "run confirm" : "yes/no question"} is above the inspector and takes the click`, async () => {
      const answers: boolean[] = []
      render(<Editor ask={ask} answers={answers} />)
      const inspector = dialog()
      expect(inspector.className).toContain(INSPECTOR_Z)
      const renderFinal = within(screen.getByTestId("review-footer")).getByRole("button", { name: /^Render final/ }) as HTMLButtonElement
      await waitFor(() => expect(renderFinal.disabled).toBe(false))
      fireEvent.click(renderFinal)

      const confirm = await screen.findByRole("alertdialog")
      const overlay = document.querySelector<HTMLElement>('[data-slot="alert-dialog-overlay"]')
      expect(confirm.className).toContain(INSPECTOR_CHILD_DIALOG_Z)
      expect(confirm.className).not.toMatch(/(^|\s)z-50(\s|$)/)
      expect(overlay?.className ?? "").toContain(INSPECTOR_CHILD_DIALOG_Z)
      // Radix holds pointer events for the newest layer only: the confirm takes them.
      expect(confirm.style.pointerEvents).not.toBe("none")
      expect(inspector.style.pointerEvents).toBe("none")

      const action = within(confirm).getByRole("button", { name: ask === "run" ? "Render final" : "Render again" })
      await act(async () => {
        fireEvent.click(action)
      })
      expect(answers).toEqual([true])
    })
  }
})
