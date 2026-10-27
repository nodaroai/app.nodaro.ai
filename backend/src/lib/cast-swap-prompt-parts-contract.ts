/**
 * The Cast Swap engine's prompt parts contract (pure; no I/O): the limits,
 * the problem codes, the override schemas, what the engine is asked and its
 * answer. The engine call itself is ee/lib/cast-swap-prompt-parts.ts; the
 * stored overrides are a trend's (ee/lib/trends/prompt-parts-store.ts) and the
 * direct runs' (nodaro-motion-prompt-parts.ts).
 */
import { z } from "zod"
import { CAST_SWAP_PROMPT_PART_IDS, type CastSwapFullDepthScene, type CastSwapPromptPartId, type CastSwapPromptStyle } from "@nodaro/render-rules"
import { CAST_SWAP_KLING_MAX_IMAGES, type CastSwapEngine } from "@nodaro/shared/models"

/** The longest text one part may hold (the engine refuses a longer one as `part_too_long`). */
export const PROMPT_PART_TEXT_MAX = 2000

/** The override text that removes a part from the prompt. */
export const PROMPT_PART_REMOVED = "-"

/** What the engine may say is wrong with a set of overrides. */
export const PROMPT_PART_PROBLEM_CODES = [
  "missing_placeholder",
  "unknown_placeholder",
  "part_not_used",
  "part_required",
  "part_too_long",
  "prompt_too_long",
] as const
export type PromptPartProblemCode = (typeof PROMPT_PART_PROBLEM_CODES)[number]

/**
 * The prompt sets the engine assembles from, by prompt style: Precise
 * (`"precise"`, a face mask's; `"precise-keep-people"`, with the depth
 * guard) and Flexible (`"flexible"`). ROLLOUT: an engine from before prompt
 * styles answers its earlier names — a face mask's (`"faces"`), keep
 * people's and a depth reference's — and is still read (the screens show the
 * name as it comes), so a staging engine one release behind never reads as
 * off the contract. Drop the earlier three once every environment's engine
 * declares `castSwap.promptStyles`.
 */
export const PROMPT_PART_SETS = ["precise", "precise-keep-people", "flexible", "faces", "keep-people", "depth-reference"] as const

export type PromptPartTexts = Partial<Record<CastSwapPromptPartId, string>>

/** Override texts as an admin sends them: per part, 1–2000 characters (`"-"` removes the part). */
export const promptPartTextsSchema = z.strictObject(
  Object.fromEntries(CAST_SWAP_PROMPT_PART_IDS.map((id) => [id, z.string().min(1).max(PROMPT_PART_TEXT_MAX).optional()])),
) as unknown as z.ZodType<PromptPartTexts>

/** Override texts as an admin's edit sends them: as above, and an empty one means "use the default" (dropped). */
export const promptPartEditsSchema = z.strictObject(
  Object.fromEntries(CAST_SWAP_PROMPT_PART_IDS.map((id) => [id, z.string().max(PROMPT_PART_TEXT_MAX).optional()])),
) as unknown as z.ZodType<PromptPartTexts>

/** What the engine is asked: the run's shape (role pictures may be placeholder addresses) and the overrides. */
export interface PromptPartsRequest {
  /** The internal engine id (every engine takes it). */
  engine: CastSwapEngine
  source?: "faces" | "full-depth" | "keep-people"
  style?: "precise" | "motion"
  /**
   * How the prompt is worded (a trend's resolved `promptStyle`; a direct
   * run's from its style and the Motion setting). Sent only to an engine that
   * declares `castSwap.promptStyles` (`askPromptParts`).
   */
  promptStyle?: CastSwapPromptStyle
  /**
   * Full depth only: where the scene comes from, resolved. Sent only to an
   * engine that declares `castSwap.fullDepthScenes` (`askPromptParts`).
   */
  scene?: CastSwapFullDepthScene
  hasAudio: boolean
  roles: unknown[]
  references?: { images: string[]; line: string }[]
  prePrompt?: string
  postPrompt?: string
  overrides?: PromptPartTexts
}

const partId = z.enum(CAST_SWAP_PROMPT_PART_IDS)

/** The engine's answer (`POST /v1/cast-swap/prompt-parts` 200), as the contract fixes it. */
export const promptPartsAnswerSchema = z.object({
  set: z.enum(PROMPT_PART_SETS),
  parts: z.array(
    z.object({
      id: partId,
      default: z.string(),
      defaultHash: z.string().regex(/^[0-9a-f]{16}$/),
      placeholders: z.array(z.string()),
      required: z.array(z.string()),
      applies: z.boolean(),
    }),
  ),
  assembled: z.string(),
  length: z.number(),
  max: z.number(),
  problems: z.array(z.object({ part: partId.optional(), code: z.enum(PROMPT_PART_PROBLEM_CODES), message: z.string() })),
})
export type PromptPartsAnswer = z.infer<typeof promptPartsAnswerSchema>

/** A role picture's stand-in: one address per role and picture, so the engine numbers each once. */
export function placeholderImageUrl(role: number, image: number): string {
  return `https://nodaro.ai/placeholder/prompt-parts/role-${role}-image-${image}.png`
}

/** A fixed reference's picture stand-in: one address per reference. */
export function placeholderReferenceUrl(reference: number): string {
  return `https://nodaro.ai/placeholder/prompt-parts/reference-${reference}.png`
}

/**
 * What one direct run may carry, as the Cast Swap engine's run body fixes it
 * (the plugin's `input.ts`, mirrored here): 6 person, 3 pet, 3 product and 1
 * location roles of 1–3 images each, 30 images in all (on Kling 4,
 * `CAST_SWAP_KLING_MAX_IMAGES`), 5 fixed references of 1–3 images with a line
 * of up to 500 characters, and role names of up to 200.
 */
export const CAST_SWAP_RUN_LIMITS = {
  /** In the order the engine writes the roles' blocks. */
  roles: [
    ["person", 6],
    ["pet", 3],
    ["product", 3],
    ["location", 1],
  ],
  imagesPerRole: 3,
  maxImages: 30,
  references: 5,
  referenceLineMax: 500,
  roleNameMax: 200,
} as const

const CHIPS_OF: Readonly<Record<string, readonly string[]>> = {
  person: ["body", "outfit", "hair"],
  pet: ["body", "coat"],
  product: ["shape", "finish"],
  location: [],
}

/**
 * The room a direct-run override save keeps for the user's own text: a pre
 * prompt and a post prompt of this many characters each (well under the run
 * body's 4,000; a rarer, longer one is refused at run as `prompt_too_long`,
 * which the user can fix).
 */
export const DIRECT_RUN_USER_PROMPT_ROOM = 1000

/**
 * A large direct run (`CAST_SWAP_RUN_LIMITS`), for checking overrides with
 * room for the user: every role the run allows with its longest name and a
 * picture (a role without one writes nothing), then every fixed reference
 * with its longest line, then more pictures per role, while the engine's
 * image cap lasts; a pre and a post prompt of `DIRECT_RUN_USER_PROMPT_ROOM`
 * characters each, and a clip with sound.
 */
export function largeDirectRun(engine: CastSwapEngine): Required<Pick<PromptPartsRequest, "roles" | "references" | "prePrompt" | "postPrompt" | "hasAudio">> {
  const L = CAST_SWAP_RUN_LIMITS
  let left: number = engine === "kling-4" ? CAST_SWAP_KLING_MAX_IMAGES : L.maxImages
  const kinds = L.roles.flatMap(([kind, n]) => Array.from({ length: n }, () => kind))
  const counts = kinds.map(() => 0)
  for (let i = 0; i < kinds.length && left > 0; i++, left--) counts[i] = 1
  const refs = Math.min(L.references, left)
  left -= refs
  for (let i = 0; i < kinds.length && left > 0; i++) {
    const more = Math.min(L.imagesPerRole - counts[i]!, left)
    counts[i]! += more
    left -= more
  }
  const fill = (lead: string, n: number) => lead.padEnd(n, "x")
  return {
    hasAudio: true,
    roles: kinds.map((kind, i) => ({
      kind,
      name: fill(`the ${kind} ${i + 1} `, L.roleNameMax),
      images: Array.from({ length: counts[i]! }, (_, j) => placeholderImageUrl(i + 1, j + 1)),
      ...Object.fromEntries((CHIPS_OF[kind] ?? []).map((chip) => [chip, "new"])),
    })),
    references: Array.from({ length: refs }, (_, r) => ({ images: [placeholderReferenceUrl(r + 1)], line: fill(`the thing ${r + 1} `, L.referenceLineMax) })),
    prePrompt: fill("Before: ", DIRECT_RUN_USER_PROMPT_ROOM),
    postPrompt: fill("After: ", DIRECT_RUN_USER_PROMPT_ROOM),
  }
}
