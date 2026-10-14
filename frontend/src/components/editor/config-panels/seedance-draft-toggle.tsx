import { isSeedanceDraftCapable, SEEDANCE_DRAFT_RESOLUTION } from "@nodaro/shared/model-catalog"
import { useT } from "@/lib/i18n"

/**
 * Seedance Draft lever, shared by every panel that can run a draft-capable
 * model (Generate Video, legacy Image/Text to Video, the Video to Video
 * Seedance edit lane).
 *
 * ON writes `draft: true` AND the 480p resolution into the node's own
 * resolution field, so every editor quote site prices 480p without knowing
 * about drafts; the server coerces 480p too (an agent or FieldMapping can still
 * pair `draft` with another resolution). OFF clears `draft` and leaves the
 * resolution where it is.
 */
export type SeedanceDraftResolutionField = "resolution" | "v2vResolution"

export function isSeedanceDraftOn(provider: string | undefined, draft: unknown): boolean {
  return draft === true && isSeedanceDraftCapable(provider)
}

/**
 * Fail-safe for the panels' provider-change effects (Provider Enum Sync 12b):
 * true when a node carries `draft` on a model that cannot draft — the effect
 * then clears it, so a stale flag never rides a later switch back unnoticed.
 */
export function hasStaleSeedanceDraft(provider: string | undefined, draft: unknown): boolean {
  return draft !== undefined && !isSeedanceDraftCapable(provider)
}

export function SeedanceDraftToggle({
  provider,
  draft,
  resolutionField,
  onUpdate,
}: {
  provider: string | undefined
  draft: unknown
  resolutionField: SeedanceDraftResolutionField
  onUpdate: (updates: Record<string, unknown>) => void
}) {
  const t = useT()
  if (!isSeedanceDraftCapable(provider)) return null
  const on = draft === true
  const id = `seedance-draft-${resolutionField}`
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 px-1">
        <input
          type="checkbox"
          id={id}
          checked={on}
          onChange={(e) =>
            onUpdate(
              e.target.checked
                ? { draft: true, [resolutionField]: SEEDANCE_DRAFT_RESOLUTION }
                : { draft: undefined },
            )
          }
          className="rounded border-muted-foreground/40"
        />
        <label htmlFor={id} className="text-xs">{t("vidcfg.seedanceDraft")}</label>
      </div>
      <p className="text-[10px] text-muted-foreground px-1">{t("vidcfg.seedanceDraftHelp")}</p>
    </div>
  )
}

/** The hint under a resolution dropdown that a draft locks. */
export function SeedanceDraftResolutionHint({ provider, draft }: { provider: string | undefined; draft: unknown }) {
  const t = useT()
  if (!isSeedanceDraftOn(provider, draft)) return null
  return <p className="text-[10px] text-muted-foreground px-1">{t("vidcfg.seedanceDraftResolutionLocked")}</p>
}
