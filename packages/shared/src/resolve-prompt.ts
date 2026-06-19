import { resolveNodeRefs } from "./node-refs.js"
import { SOCIAL_POST_NODE_TYPES } from "./social-post.js"

export interface ResolvePromptArgs {
  override?: string
  typed?: ReadonlyArray<string | undefined>
  wired?: string
  refMap: ReadonlyMap<string, string>
  /** Opt-in (generate-image / generate-video only): APPEND the wired
   *  (connected-prompt) value to the TYPED base instead of treating wired as a
   *  fallback, so a connected prompt auto-injects alongside the typed prompt. An
   *  `override` (list fan-out item) still fully replaces — no wired append.
   *  Off/undefined = exact legacy precedence (override > typed > wired) for every
   *  other node type. */
  appendWired?: boolean
}
const present = (s?: string): s is string => typeof s === "string" && s.trim().length > 0
const rr = (s: string, m: ReadonlyMap<string, string>) => (m.size > 0 ? resolveNodeRefs(s, m) : s)

/** SINGLE SOURCE OF TRUTH for prompt precedence across both DAG engines:
 *  override (list fan-out) > first present typed candidate > wired > "".
 *  "present" = non-empty after trim. {Label} refs are resolved on the chosen
 *  branch via the shared resolveNodeRefs. With `appendWired`, the chosen base
 *  AND the wired value are both emitted (joined ". "). */
export function resolvePrompt({ override, typed = [], wired, refMap, appendWired }: ResolvePromptArgs): string {
  // appendWired: a connected prompt APPENDS to the TYPED base. An `override`
  // (list fan-out item) still fully REPLACES — it never receives a wired append,
  // so per-item fan-out prompts are unchanged.
  if (appendWired && !present(override)) {
    const base = typed.find(present)
    return [base, wired].filter(present).map((s) => rr(s, refMap)).join(". ")
  }
  if (present(override)) return rr(override, refMap)
  for (const t of typed) if (present(t)) return rr(t, refMap)
  if (present(wired)) return rr(wired, refMap)
  return ""
}

/** Compose a final NEGATIVE prompt from a TYPED base + a WIRED (connected
 *  negative-handle) value: both are emitted, joined ". " (mirrors `appendWired`
 *  for the positive prompt). Pure join — the caller resolves `{label}` refs on
 *  the typed value first, and the wired value is already a resolved output that
 *  the input-resolver has filtered (referenced / Inject-Negative-off dropped).
 *  Generate-image / generate-video only; empty parts are dropped. */
export function composeNegative(typed?: string, wired?: string): string {
  return [typed, wired].filter(present).join(". ")
}

/** Ordered typed-candidate fields per node type — the precedence source of
 *  truth (NOT NODE_MAPPABLE_FIELDS, which is field-mapping eligibility, omits
 *  video-retake, and orders llm-chat wrong). */
export const NODE_PROMPT_CANDIDATE_FIELDS: Readonly<Record<string, readonly string[]>> = {
  "generate-image": ["prompt"],
  // motionPrompt is here so generate-video re-typed to text-to-video keeps a
  // prompt stored in data.motionPrompt (the inline picker's legacy field). Safe
  // for a standalone text-to-video node — it never carries data.motionPrompt.
  "text-to-video": ["prompt", "motionPrompt"],
  "video-to-video": ["prompt"],
  "generate-music": ["prompt"],
  "speech-to-video": ["prompt"],
  "cinematic-avatar": ["prompt"],
  "extend-video": ["prompt"],
  "video-retake": ["prompt"],
  "suno-replace-section": ["prompt"],
  "image-to-video": ["prompt", "motionPrompt"],
  "generate-video": ["prompt", "motionPrompt"],
  "text-to-audio": ["prompt", "text"],
  // Social posts: the orchestrator + frontend executor match per-platform node
  // types (node.type is "instagram-post", "telegram-post", …), NOT a unified
  // "social-publish" type — so every platform needs its own ["caption"] entry.
  // Derived from the shared SOCIAL_POST_NODE_TYPES single source of truth so a
  // new platform can't drift out of the precedence map.
  ...Object.fromEntries(
    [...SOCIAL_POST_NODE_TYPES].map((t) => [t, ["caption"] as readonly string[]]),
  ),
  // Kept for any caller that passes the aggregate type instead of a platform.
  "social-publish": ["caption"],
}

export interface ComputeNodePromptArgs {
  override?: string
  wired?: string
  refMap: ReadonlyMap<string, string>
  /** See ResolvePromptArgs.appendWired — generate-image / generate-video only. */
  appendWired?: boolean
}
/** Resolve a single-prompt node's final prompt (typed-primary). Both engines
 *  call this so field-selection + precedence are structurally identical. */
export function computeNodePrompt(
  nodeType: string,
  data: Record<string, unknown>,
  { override, wired, refMap, appendWired }: ComputeNodePromptArgs,
): string {
  let typed: ReadonlyArray<string | undefined>
  if (nodeType === "text-to-speech") {
    // data.text is a phantom field on TTS; only directText (gated) is real.
    typed = data.textSource === "direct" ? [data.directText as string | undefined] : []
  } else {
    const fields = NODE_PROMPT_CANDIDATE_FIELDS[nodeType] ?? ["prompt"]
    typed = fields.map((f) => data[f] as string | undefined)
  }
  return resolvePrompt({ override, typed, wired, refMap, appendWired })
}

export interface LlmChatFieldArgs {
  override?: string
  wiredUserInput?: string
  wiredSystemPrompt?: string
  refMap: ReadonlyMap<string, string>
}
/** llm-chat resolves TWO independent fields. override applies to userInput only. */
export function computeLlmChatFields(
  data: Record<string, unknown>,
  { override, wiredUserInput, wiredSystemPrompt, refMap }: LlmChatFieldArgs,
): { userInput: string; systemPrompt: string } {
  return {
    userInput: resolvePrompt({ override, typed: [data.userInput as string | undefined], wired: wiredUserInput, refMap }),
    systemPrompt: resolvePrompt({ typed: [data.systemPrompt as string | undefined], wired: wiredSystemPrompt, refMap }),
  }
}
