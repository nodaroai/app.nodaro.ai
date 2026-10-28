import { Suspense, lazy, useState } from "react"
import { BookMarked } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useAuth } from "@/hooks/use-auth"
import { isMultiUser } from "@/lib/edition"
import type { KeeperKind } from "@/lib/api"
import { useT, type MessageKey } from "@/lib/i18n"

// Lazy dynamic import keeps this core file off the ee/ static-import graph
// (check-ee-imports.mjs only flags top-level `import ... from "@/ee/..."`,
// not `import()` call expressions — the PublishDialog pattern in the studios).
const KeeperShelfDialog = lazy(() => import("@/ee/components/keepers/shelf-dialog"))

/** Why the button is disabled before the item is saved — each studio's own wording. */
const NEEDS_SAVE_KEY: Record<KeeperKind, MessageKey> = {
  character: "studio.genAppearanceFirstCharacter",
  creature: "creature.shareNeedsSave",
  location: "studio.genAppearanceFirstLocation",
  object: "studio.genAppearanceFirstObject",
}

export interface KeepersShelfButtonProps {
  kind: KeeperKind
  /** The saved row's id; `""` / undefined before the first save. */
  dbId: string | null | undefined
  /** The approved main image; an item without one stays off the shelf even when marked. */
  sourceImageUrl: string | null | undefined
}

/**
 * The studio-header button that opens the Nodaro Keepers shelf dialog for the
 * item being edited. Rendered only for a platform admin on a multi-user
 * edition (the shelf's own gate); disabled, with the reason, until the item
 * is saved and has a main image.
 */
export function KeepersShelfButton({ kind, dbId, sourceImageUrl }: KeepersShelfButtonProps) {
  const t = useT()
  const { isAdmin } = useAuth()
  const [open, setOpen] = useState(false)
  // The ee chunk is fetched on the first click, not on every studio open; once
  // opened the dialog stays mounted so its close animation and state survive.
  const [everOpened, setEverOpened] = useState(false)

  if (!isAdmin || !isMultiUser()) return null

  const reason: MessageKey | null = !dbId ? NEEDS_SAVE_KEY[kind] : !sourceImageUrl ? "keepers.needsMainImage" : null

  return (
    <>
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger asChild>
            {/* span wrapper so the tooltip still fires while the button is disabled —
                focusable then, so a keyboard user reaches the reason too */}
            <span tabIndex={reason ? 0 : undefined}>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 text-[11px] text-slate-300 hover:text-white hover:bg-[#1e293b]"
                disabled={reason !== null}
                onClick={() => {
                  setEverOpened(true)
                  setOpen(true)
                }}
              >
                <BookMarked className="h-3.5 w-3.5" />
                {t("keepers.shelfButton")}
              </Button>
            </span>
          </TooltipTrigger>
          {reason && <TooltipContent side="bottom">{t(reason)}</TooltipContent>}
        </Tooltip>
      </TooltipProvider>
      {dbId && everOpened && (
        <Suspense fallback={null}>
          <KeeperShelfDialog kind={kind} entityId={dbId} open={open} onOpenChange={setOpen} />
        </Suspense>
      )}
    </>
  )
}
