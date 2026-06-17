import type { StudioPageProps } from "../../studio-shell/types"
import type { CharacterStudioState } from "../use-character-studio"
import type { CharacterStudioJobs } from "../use-character-studio-jobs"
import { optimizedImageUrl } from "@/lib/image"
import { characterBoardItems } from "@nodaro/shared"
import { injectAssetAsCanvasNode, setCharacterNodeDefaultAsset } from "../inject-helpers"
import { cn } from "@/lib/utils"
import { Star, Plus } from "lucide-react"

/**
 * Board page — read-only display of the character's named composite reference
 * boards, mirroring studio.nodaro.ai's "Board" tab. Resolves boards from BOTH
 * the `boards` column AND the legacy `selected_asset_by_variant` shim
 * (`characterBoardItems`), so pre-column boards show too. Each board can be set
 * as the node's default image (★) or dropped onto the canvas (＋); referencing
 * via `@` works through the shared mentionable-asset surface.
 */
export function BoardPage({ state }: StudioPageProps<CharacterStudioState, CharacterStudioJobs>) {
  const boards = characterBoardItems(state.staged as unknown as Record<string, unknown>)
  const defaultUrl = (state.staged as { defaultAssetUrl?: string }).defaultAssetUrl

  if (boards.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-3 py-6 text-center">
        <p className="text-sm text-muted-foreground">No reference boards yet.</p>
        <p className="mt-1 text-xs text-muted-foreground/70">Boards created in the studio appear here.</p>
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
            <a href={b.url} target="_blank" rel="noopener noreferrer" title="Open full size">
              <img src={optimizedImageUrl(b.url)} alt={b.name} className="w-full object-contain" loading="lazy" />
            </a>
            <div className="absolute right-1.5 top-1.5 flex gap-1 opacity-0 transition group-hover:opacity-100">
              <button
                type="button"
                title="Set as the character node's default image"
                onClick={() => setCharacterNodeDefaultAsset(state.staged, state.patch, b)}
                className={cn(
                  "rounded p-1",
                  defaultUrl === b.url ? "bg-yellow-400 text-black" : "bg-black/60 text-white hover:bg-black/80",
                )}
              >
                <Star className="size-3.5" />
              </button>
              <button
                type="button"
                title="Use on canvas (creates an upload-image node)"
                onClick={() => injectAssetAsCanvasNode({ sourceCharacterNodeId: state.nodeId, item: b, isVideo: false })}
                className="rounded bg-black/60 p-1 text-white hover:bg-black/80"
              >
                <Plus className="size-3.5" />
              </button>
            </div>
            {b.name && (
              <figcaption className="truncate px-2 py-1.5 text-xs text-muted-foreground">{b.name}</figcaption>
            )}
          </figure>
        ))}
      </div>
    </div>
  )
}
