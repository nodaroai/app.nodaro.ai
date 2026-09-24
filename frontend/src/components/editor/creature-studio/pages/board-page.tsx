import type { StudioPageProps } from "../../studio-shell/types"
import type { CreatureStudioState } from "../use-creature-studio"
import type { CreatureStudioJobs } from "../use-creature-studio-jobs"
import { optimizedImageUrl } from "@/lib/image"
import { useT } from "@/lib/i18n"

/**
 * Board page — read-only display of the creature's named composite reference
 * boards (the `boards` JSONB column, hydrated from the GET route), mirroring
 * studio.nodaro.ai's "Board" tab. Boards are authored in the sister studio app;
 * here they're display-only this phase (no generation UI). Each board opens
 * full-size in a new tab — same enlarge affordance as the character Board page.
 */
export function BoardPage({ state }: StudioPageProps<CreatureStudioState, CreatureStudioJobs>) {
  const t = useT()
  const boards = state.stagedData?.boards ?? []

  if (boards.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-3 py-6 text-center">
        <p className="text-sm text-muted-foreground">{t("creature.noBoardsYet")}</p>
        <p className="mt-1 text-xs text-muted-foreground/70">{t("creature.boardsHint")}</p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {boards.map((b, i) => (
          <figure
            key={`${b.name}-${i}`}
            className="group relative overflow-hidden rounded-md border border-border bg-[#1a1d27]"
          >
            <a href={b.url} target="_blank" rel="noopener noreferrer" title={t("creature.openFullSize")}>
              <img src={optimizedImageUrl(b.url)} alt={b.name} className="w-full object-contain" loading="lazy" />
            </a>
            {b.name && (
              <figcaption className="truncate px-2 py-1.5 text-xs text-muted-foreground">{b.name}</figcaption>
            )}
          </figure>
        ))}
      </div>
    </div>
  )
}
