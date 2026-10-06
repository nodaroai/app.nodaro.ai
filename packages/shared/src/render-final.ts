/**
 * Render final for agents (`renderFinal: { renderNodeId }` on
 * `POST /v1/workflows/:id/run`, the SDK's `workflows.renderFinal`, MCP
 * `render_final`; decided 2026-10-06). The server derives the nodes the run
 * executes and the render's one-shot Final override from the saved graph.
 *
 * The stable codes a Render final request is refused with when the node it
 * names cannot be rendered. A client branches on the code, never on the text.
 */

/** The workflow has no node with that id. */
export const RENDER_FINAL_NODE_NOT_FOUND = "render_final_node_not_found"

/** The node is not a render a Render final can run (an Apply EDL render). */
export const RENDER_FINAL_NOT_A_RENDER = "render_final_not_a_render"

/** Every Render final refusal code. */
export const RENDER_FINAL_CODES = [RENDER_FINAL_NODE_NOT_FOUND, RENDER_FINAL_NOT_A_RENDER] as const

export type RenderFinalCode = (typeof RENDER_FINAL_CODES)[number]
