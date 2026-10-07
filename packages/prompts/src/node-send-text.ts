import { resolveNodeRefs, SOCIAL_POST_NODE_TYPES } from "@nodaro/shared"
import { computeLlmChatFields, computeNodePrompt, computeScriptTopic } from "./resolve-prompt.js"

/**
 * Output nodes that send exactly what is WIRED into them — a webhook's
 * parameters, a social post's caption and media. When every wire produced
 * nothing in this run (a Filter List that kept no row, a node that was itself
 * skipped), there is nothing to send: the node is skipped with
 * `skipReason: "empty_input"` instead of posting an empty payload (a site that
 * validates its input answers 400 and alerts its owner) or failing the run
 * (a publish route refuses a post with no text and no media). A typed caption
 * with no wire at all is the author's choice and still runs, as before. ONE
 * list, read by the orchestrator's skip rule (`empty-input-skips.ts`).
 */
export const WIRED_OUTPUT_NODE_TYPES: ReadonlySet<string> = new Set(["webhook-output", ...SOCIAL_POST_NODE_TYPES])

/**
 * Node types that send TEXT to a model or a voice and fail on an empty one —
 * `userInput: Too small` (llm-chat), "no text found" (text-to-speech) — so a
 * run with nothing upstream can skip them instead of failing. Never an image
 * or video node (an empty prompt is a legal request there) and never a social
 * post (an empty caption is the author's choice). ONE list, read by the
 * orchestrator's skip rule (`empty-input-skips.ts`); the engine never names a
 * type on its own.
 */
export const TEXT_REQUIRED_NODE_TYPES: ReadonlySet<string> = new Set([
  "llm-chat",
  "ai-writer",
  "generate-script",
  "text-to-speech",
  "generate-music",
  "text-to-audio",
  // Save to Collection refuses an empty record ("nothing to save"): a feed
  // with nothing new wired straight into it must skip it, not fail the run.
  "collection-write",
  // Generate Image: an empty prompt is a legal request in general (references
  // alone), but when the text it was WIRED produced nothing this run — the skip
  // rule's precondition — an empty prompt is a paid picture of nothing.
  "generate-image",
])

/**
 * The node's data without its prompt pre/post text: the skip decision is about
 * the CORE text. A prefix alone ("Write a news item about:") is not something
 * to send — with the affixes applied, an empty core read as non-empty and an
 * idle tick paid for a model call on the prefix.
 */
const withoutAffixes = (data: Record<string, unknown>): Record<string, unknown> => ({ ...data, promptPrefix: undefined, promptSuffix: undefined })

export interface NodeSendTextArgs {
  /** A list fan-out item (highest precedence). */
  override?: string
  /** The text wired into the node's main text input. */
  wired?: string
  /** llm-chat only: the text wired into `system-prompt`. */
  wiredSystemPrompt?: string
  refMap: ReadonlyMap<string, string>
}

const present = (s?: string): s is string => typeof s === "string" && s.trim().length > 0

/**
 * ai-writer's user input — the rule its sync-HTTP body applies: a fan-out
 * item, else the wired text, else the typed `userInput`, else the legacy
 * `prompt`. (ai-writer is renamed to llm-chat on load; saved graphs that
 * never reloaded still run it.)
 */
export function computeAiWriterInput(
  data: Record<string, unknown>,
  { override, wired }: Pick<NodeSendTextArgs, "override" | "wired">,
): string {
  return [override, wired, data.userInput as string | undefined, data.prompt as string | undefined].find(present) ?? ""
}

/**
 * The text a text-requiring node would send, by the SAME rule its executor
 * uses (`computeLlmChatFields`, `computeScriptTopic`, `computeNodePrompt`,
 * `computeAiWriterInput`) — so "would this node run on nothing?" is answered
 * by the function that decides what it sends, not by a second reading of it.
 * Undefined for any other node type.
 */
export function computeNodeSendText(
  nodeType: string,
  data: Record<string, unknown>,
  args: NodeSendTextArgs,
): string | undefined {
  const bare = withoutAffixes(data)
  switch (nodeType) {
    case "llm-chat":
      return computeLlmChatFields(bare, {
        override: args.override,
        wiredUserInput: args.wired,
        wiredSystemPrompt: args.wiredSystemPrompt,
        refMap: args.refMap,
      }).userInput
    case "ai-writer":
      return computeAiWriterInput(bare, args)
    case "generate-script":
      return computeScriptTopic(bare, { override: args.override, wired: args.wired, refMap: args.refMap })
    case "generate-music": {
      // A music node sings typed lyrics with no prompt; only both empty is nothing to send.
      const prompt = computeNodePrompt(nodeType, bare, { override: args.override, wired: args.wired, refMap: args.refMap })
      return present(prompt) ? prompt : present(data.lyrics as string | undefined) ? (data.lyrics as string) : ""
    }
    case "text-to-speech":
    case "text-to-audio":
    case "generate-image":
      return computeNodePrompt(nodeType, bare, { override: args.override, wired: args.wired, refMap: args.refMap })
    case "collection-write": {
      // The record's content: the item (a fan-out row, else what reached `in`),
      // else a title, text or link typed on the node. A picture alone is a
      // record too, but it never starves the node: only a wired TEXT input that
      // produced nothing can (the skip rule's precondition).
      // A typed field counts as the engines send it, its `{Node}` references
      // resolved: `{Feed || }` over a feed with nothing new is empty, so the
      // node skips instead of failing with an empty record (#1890).
      const typed = [data.title, data.text, data.link]
        .map((v) => (typeof v === "string" ? resolveNodeRefs(v, args.refMap) : v))
        .find((v): v is string => present(v as string | undefined))
      return [args.override, args.wired, typed].find(present) ?? ""
    }
    default:
      return undefined
  }
}
