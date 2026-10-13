/**
 * The nodes a published app shows as its inputs — the ONE reading the server's input schema
 * (`extractAppInputSchema`: an app's runs, MCP `get_app_inputs`, the SDK) and the editor's publish
 * dialog both use: its curated input list, else its input order, else — an app that curated none —
 * every node of a type an app takes as an input by itself (`APP_IMPLICIT_INPUT_TYPES`).
 */
import { migrateToItems, type PresentationItem } from "@nodaro/shared"

/** The node types an app that curated no inputs shows as its inputs, every one of them. */
export const APP_IMPLICIT_INPUT_TYPES: ReadonlySet<string> = new Set(["text-prompt", "upload-image", "upload-video", "upload-audio", "list", "location"])

interface AppInputNode {
  readonly id: string
  readonly type?: string | null
}
interface AppPresentationSettings {
  readonly inputItems?: readonly PresentationItem[]
  readonly inputOrder?: readonly string[]
}

/** The items an app shows as its inputs (see the file comment). */
export function appInputItems(settings: AppPresentationSettings | null | undefined, nodes: ReadonlyArray<AppInputNode> | null | undefined): PresentationItem[] {
  const items = settings?.inputItems ?? migrateToItems(settings?.inputOrder ? [...settings.inputOrder] : undefined)
  if (items && items.length > 0) return [...items]
  return (nodes ?? []).filter((n) => typeof n.type === "string" && APP_IMPLICIT_INPUT_TYPES.has(n.type)).map((n) => ({ type: "node" as const, nodeId: n.id }))
}

/** The node ids a presentation item list names, groups included. */
export function presentationItemNodeIds(items: readonly PresentationItem[]): Set<string> {
  const ids = new Set<string>()
  for (const item of items) {
    if ("nodeId" in item) ids.add(item.nodeId)
    if (item.type === "group") for (const id of presentationItemNodeIds(item.items)) ids.add(id)
  }
  return ids
}

/** The node ids an app shows as its inputs (see the file comment). */
export function appInputNodeIds(settings: AppPresentationSettings | null | undefined, nodes: ReadonlyArray<AppInputNode> | null | undefined): Set<string> {
  return presentationItemNodeIds(appInputItems(settings, nodes))
}
