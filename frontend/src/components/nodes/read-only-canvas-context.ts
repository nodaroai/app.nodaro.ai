import { createContext, useContext } from "react"

/**
 * How the canvas around a node may be used. `editor` is the default: the
 * normal, editable canvas. Inside a canvas that only SHOWS a workflow (the view
 * link, its embed, the sub-workflow viewer) nothing runs, saves or opens
 * settings, and BaseNode reads this once to drop every piece of editing chrome
 * — hover toolbar, run strip, resize corners, inline prompt editor — so no node
 * needs its own check. Hooks that would ask the server about a node for the
 * editor (prices, a result's job) read it too and stay quiet.
 *
 * - `view`: the workflow store holds exactly the nodes on screen (the view
 *   pages seed it), so a node may keep its own box in step as the editor does.
 * - `view-detached`: the store belongs to someone else (the editor, under the
 *   sub-workflow viewer); a node on this canvas must never write to it.
 */
export type CanvasMode = "editor" | "view" | "view-detached"

export const CanvasModeContext = createContext<CanvasMode>("editor")

export function useCanvasMode(): CanvasMode {
  return useContext(CanvasModeContext)
}

/** True on a canvas that only shows a workflow. */
export function useReadOnlyCanvas(): boolean {
  return useContext(CanvasModeContext) !== "editor"
}
