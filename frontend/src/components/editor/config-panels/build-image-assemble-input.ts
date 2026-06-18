import type { AssembleImageInput, IdentityMeta } from "@nodaro/shared"
import { collectAncestorRefs } from "@/components/editor/workflow-editor/execution-graph"
import type {
  WorkflowNode,
  WorkflowEdge,
  CharacterDefinition,
} from "@/types/nodes"
import { getConnectedSources } from "./helpers"
import { stampElementInjections } from "@/components/editor/workflow-editor/node-input-resolver"
import {
  buildImageConnectedReferences,
  type ConnectedRefsData,
} from "./connected-references"

/**
 * Build the `AssembleImageInput` for an image node's PREVIEW so the inline
 * final-prompt view routes through the SAME shared assembler the run uses
 * (`assembleImageInput`) with the FULL input set — closing the gap where the
 * old preview dropped `userTemplates` / `flowTemplates` / `ancestorRefs` /
 * `referenceOrder` / suppressions and so showed less text than the run sends.
 *
 * Mirrors the run's `assembleImageInput(...)` argument object at
 * `execute-node.ts` AS CLOSELY AS A LIVE PREVIEW CAN. The one deliberate
 * divergence (scoping decision — see the Phase-2 brief): the run builds
 * `connectedReferences` from RESOLVED upstream inputs (post input-resolver),
 * which a live preview can't reproduce for un-executed nodes. So we build them
 * the way the quick-edit modal does (`buildImageConnectedReferences`), which is
 * correct for the prompt TEXT (the directive block uses labels / descriptions /
 * order / count, not URLs). URL selection for un-run upstreams is an accepted
 * best-effort preview limitation.
 *
 * Pure — no store access. The hook passes the store slices
 * (`userPromptTemplates` / `flowPromptTemplates` / `characterDefinitions`) in.
 * Never sets `skipCharacterMentions` (LoRA is a run-only payload concern) nor
 * `throwOnEmpty` (a preview must never throw).
 */
export interface BuildImageAssembleInputArgs {
  /** The consumer (image) node whose prompt is being previewed. */
  readonly node: WorkflowNode
  readonly nodes: ReadonlyArray<WorkflowNode>
  readonly edges: ReadonlyArray<WorkflowEdge>
  /** Library/store character definitions (the quick-edit modal's source). */
  readonly characterDefinitions: ReadonlyArray<CharacterDefinition>
  /** User-level prompt template overrides (store slice). */
  readonly userPromptTemplates?: Record<string, string>
  /** Flow-level prompt template overrides (store slice). */
  readonly flowPromptTemplates?: Record<string, string>
  /**
   * The already-composed prompt — user prose + cinematography hints + identity
   * clause — exactly as the hook computes `preBuildPrompt`. Passed as
   * `userPrompt` with NO `direction` / `structured` (the shared composer is a
   * no-op for those), so the assembled text is byte-identical to the run.
   */
  readonly composedPrompt: string
  readonly provider: string
  readonly style?: string
  /** A connected Style node bypasses the inline `style` lever (run parity). */
  readonly styleBypass: boolean
  /** The resolved ({variables}-expanded) negative prompt. */
  readonly resolvedNegative?: string
}

export function buildImageAssembleInput(
  args: BuildImageAssembleInputArgs,
): AssembleImageInput {
  const {
    node,
    nodes,
    edges,
    characterDefinitions,
    userPromptTemplates,
    flowPromptTemplates,
    composedPrompt,
    provider,
    style,
    styleBypass,
    resolvedNegative,
  } = args

  const data = (node.data ?? {}) as Record<string, unknown>

  // Connected references — built exactly like the quick-edit modal
  // (`buildImageConnectedReferences` + `getConnectedSources` + attachedChars
  // derived from `characterDefinitionIds` × `characterDefinitions`). Correct
  // for the prompt TEXT; URL fidelity for un-run upstreams is best-effort.
  const attachedIds = (data.characterDefinitionIds as readonly string[] | undefined) ?? []
  const attachedChars = characterDefinitions.filter((c) => attachedIds.includes(c.id))
  const connectedReferences = stampElementInjections(
    buildImageConnectedReferences({
      data: data as unknown as ConnectedRefsData,
      sources: getConnectedSources(node.id, edges, nodes),
      nodes,
      attachedChars,
    }),
    node.id,
    nodes,
    edges,
  )

  // Ancestor-ref fallback — only when there are no connected-reference URLs,
  // mirroring execute-node's `orderedUrls.length === 0 ? collectAncestorRefs : []`.
  // `collectAncestorRefs` only READS the graph (it walks ancestors); the casts
  // bridge our `ReadonlyArray` params to its mutable-typed signature without any
  // mutation. (Widening that signature would cascade into `@nodaro/shared`,
  // outside this hook-scoped change.)
  const orderedUrls = connectedReferences.map((r) => r.url)
  const ancestorRefs =
    orderedUrls.length === 0
      ? collectAncestorRefs(node.id, nodes as WorkflowNode[], edges as WorkflowEdge[])
      : []

  const identityMeta = (data.identityMeta as readonly IdentityMeta[] | undefined) ?? []
  const referenceOrder = data.referenceOrder as readonly string[] | undefined
  const suppressedCanonicalCharacterIds = data.suppressedCanonicalCharacterIds as
    | readonly string[]
    | undefined
  const suppressedCanonicalLocationIds = data.suppressedCanonicalLocationIds as
    | readonly string[]
    | undefined

  return {
    userPrompt: composedPrompt,
    provider,
    style: styleBypass ? undefined : style,
    negativePrompt: resolvedNegative || undefined,
    connectedReferences,
    identityMeta,
    userTemplates: userPromptTemplates,
    flowTemplates: flowPromptTemplates,
    // Empty array is intentionally NOT passed (kept undefined) so the shared
    // assembler's no-op default applies — matching execute-node, which passes
    // the array only when populated by spread.
    ancestorRefs: ancestorRefs.length > 0 ? ancestorRefs : undefined,
    referenceOrder: referenceOrder ?? undefined,
    suppressedCanonicalCharacterIds: suppressedCanonicalCharacterIds ?? undefined,
    suppressedCanonicalLocationIds: suppressedCanonicalLocationIds ?? undefined,
  }
}
