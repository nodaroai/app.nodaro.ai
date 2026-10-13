/**
 * Canvas macros: add-node menu entries that insert SEVERAL real nodes at once
 * instead of one. "Reframe" is the first (decided 2026-10-11, D11 (d)).
 *
 * A macro is deliberately NOT a node type: it has no `NODE_DEFINITIONS` entry,
 * no executor and no backend registration, so nothing — MCP, an import, the
 * Copilot — can write one into workflow JSON and expect an engine to run it.
 * The menu lists it through `NODE_OPTIONS` (the one catalogue both add-node
 * surfaces render) under its macro id cast to a `SceneNodeType`, the way
 * "component" already is; every place that creates a node from a picked entry
 * asks `isCanvasMacroType` first and routes it to `insertCanvasMacro`
 * (`hooks/use-canvas-macro.ts`). `canvas-macro-dispatch.test.ts` fails a
 * creation site that forgets to.
 */
import { speakerViewVideoModeLive } from "@nodaro/render-rules"
import type { SceneNodeType } from "@/types/nodes"
import type { NodeOption } from "@/lib/node-compatibility"
import { REFRAME_CHILD_TYPES, REFRAME_MACRO_ID, emitsVideo } from "@/lib/reframe-macro"

export interface CanvasMacro {
  /** The id the menu entry carries as its `type`. */
  readonly type: string
  /** The real nodes it inserts: the macro is offered only where all of them are. */
  readonly childTypes: readonly SceneNodeType[]
  /**
   * Whether what it inserts may be offered at all yet. Read at CALL time, never
   * captured, so a withdrawn or newly set price changes the menu without a
   * rebuild. Reframe feeds Speaker View a video, so it waits for video mode
   * (decided 2026-10-12, R7 and R15: Speaker View AND Speaker Frames priced,
   * `speakerViewVideoModeLive`): until then it is hidden from every add-node
   * surface and refused by the insert.
   */
  readonly priced: () => boolean
}

/**
 * The menu-entry "type" of the Reframe macro. It is not a `SceneNodeType`
 * (there is no such node), so the cast lives here, once, and the catalogue and
 * the family registry both use this constant instead of repeating it.
 */
export const REFRAME_ENTRY_TYPE = REFRAME_MACRO_ID as SceneNodeType

export const CANVAS_MACROS: readonly CanvasMacro[] = [
  { type: REFRAME_MACRO_ID, childTypes: REFRAME_CHILD_TYPES, priced: () => speakerViewVideoModeLive() },
]

const MACRO_TYPES: ReadonlySet<string> = new Set(CANVAS_MACROS.map((m) => m.type))

/** True for a menu entry that inserts a macro rather than a node of that type. */
export const isCanvasMacroType = (type: string | null | undefined): boolean => !!type && MACRO_TYPES.has(type)

export const canvasMacroOf = (type: string | null | undefined): CanvasMacro | undefined =>
  CANVAS_MACROS.find((m) => m.type === type)

/** True for a macro the menus may offer now (its price is set). */
export const isCanvasMacroOffered = (type: string | null | undefined): boolean => canvasMacroOf(type)?.priced() ?? false

/**
 * A group a macro made (its `data.macro` names the macro). Its children are
 * real nodes that each charge their own price; the group has none of its own
 * and only SUMS them for display (`groupCreditSubtotals`).
 */
export const isMacroGroup = (node: { readonly type?: string | null; readonly data?: unknown } | undefined): boolean =>
  node?.type === "group" && typeof (node.data as { macro?: unknown } | undefined)?.macro === "string"

/**
 * The macros an edge-drop menu offers as DIRECT matches. A macro has no handles
 * for the compatibility rules to read, so it is kept out of them
 * (`withoutMacros`) and offered here instead: for exactly one thing — a video
 * output (`direction: "source"`), because that video is what it wires into its
 * three nodes. Dragging from an input asks for a producer, which a macro is not.
 */
export function macrosForConnection(
  pool: readonly NodeOption[],
  ctx: { readonly handleId: string; readonly direction: "source" | "target"; readonly nodeType?: string },
): NodeOption[] {
  return ctx.direction === "source" && emitsVideo(ctx.nodeType, ctx.handleId) ? pool.filter((o) => isCanvasMacroOffered(o.type)) : []
}

export const withoutMacros = (pool: readonly NodeOption[]): NodeOption[] => pool.filter((o) => !isCanvasMacroType(o.type))
