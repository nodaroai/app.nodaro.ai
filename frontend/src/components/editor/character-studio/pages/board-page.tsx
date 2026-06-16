import type { StudioPageProps } from "../../studio-shell/types"
import type { CharacterStudioState } from "../use-character-studio"
import type { CharacterStudioJobs } from "../use-character-studio-jobs"
import { optimizedImageUrl } from "@/lib/image"

/**
 * Board page — read-only display of the character's named composite reference
 * boards (the `boards` JSONB column, migration 212), mirroring the "Board" tab
 * of studio.nodaro.ai's character page. Data is hydrated by `getCharacter` →
 * `staged.boards`; this page only renders it (no generation/upload — that's the
 * "display first" scope).
 */
export function BoardPage({ state }: StudioPageProps<CharacterStudioState, CharacterStudioJobs>) {
  const boards = state.staged.boards ?? []

  if (boards.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-3 py-6 text-center">
        <p className="text-sm text-muted-foreground">No reference boards yet.</p>
        <p className="mt-1 text-xs text-muted-foreground/70">
          Boards created in the studio appear here.
        </p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {boards.map((b, i) => (
          <figure
            key={`${b.name}-${i}`}
            className="overflow-hidden rounded-md border border-border bg-[#1a1d27]"
          >
            <a href={b.url} target="_blank" rel="noopener noreferrer" title="Open full size">
              <img
                src={optimizedImageUrl(b.url)}
                alt={b.name}
                className="w-full object-contain"
                loading="lazy"
              />
            </a>
            {b.name && (
              <figcaption className="truncate px-2 py-1.5 text-xs text-muted-foreground">
                {b.name}
              </figcaption>
            )}
          </figure>
        ))}
      </div>
    </div>
  )
}
