import { useState } from "react"
import { Globe, Loader2, Lock } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useT, type TFunction } from "@/lib/i18n"
import { useUpdatePublicOutputsMutation } from "@/hooks/queries/use-user-settings-queries"

interface GalleryVisibilityCardProps {
  userId: string
  publicOutputs: boolean
  /** Whether this plan may switch outputs to private. */
  canToggle: boolean
}

/** The success toast after switching to private: how many items left the gallery. */
export function privateToastMessage(t: TFunction, hidden: number): string {
  if (hidden <= 0) return t("settings.outputsPrivate")
  if (hidden === 1) return t("settings.outputsPrivateHiddenOne")
  return t("settings.outputsPrivateHiddenMany", { count: hidden })
}

/**
 * Settings → Gallery Visibility. Switching to private also takes the person's
 * existing items out of the public gallery (the server does both in one
 * transaction), so it asks first and says so. Switching back to public needs
 * no confirmation: it republishes nothing, which the private description says.
 */
export function GalleryVisibilityCard({ userId, publicOutputs, canToggle }: GalleryVisibilityCardProps) {
  const t = useT()
  const mutation = useUpdatePublicOutputsMutation()
  const [confirmOpen, setConfirmOpen] = useState(false)

  async function apply(next: boolean) {
    try {
      const saved = await mutation.mutateAsync({ userId, publicOutputs: next })
      toast.success(next ? t("settings.outputsPublic") : privateToastMessage(t, saved.hiddenFromGallery))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("settings.failedToUpdate"))
    }
  }

  function handleClick() {
    if (publicOutputs) setConfirmOpen(true)
    else void apply(true)
  }

  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-card p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            {publicOutputs ? (
              <Globe className="h-4 w-4 text-muted-foreground" />
            ) : (
              <Lock className="h-4 w-4 text-muted-foreground" />
            )}
            <h2 className="text-base font-semibold">{t("settings.galleryVisibility")}</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {publicOutputs ? t("settings.galleryPublicDesc") : t("settings.galleryPrivateDesc")}
          </p>
        </div>

        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!canToggle || mutation.isPending}
                  onClick={handleClick}
                  className={cn(
                    "min-w-[100px]",
                    !publicOutputs && canToggle && "border-[#ff0073] text-primary-ink",
                  )}
                >
                  {mutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : publicOutputs ? (
                    t("settings.makePrivate")
                  ) : (
                    t("settings.makePublic")
                  )}
                </Button>
              </span>
            </TooltipTrigger>
            {!canToggle && <TooltipContent>{t("settings.availableOnPlan")}</TooltipContent>}
          </Tooltip>
        </TooltipProvider>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("settings.makePrivateConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("settings.makePrivateConfirmDesc")}</AlertDialogDescription>
            <p className="text-sm text-muted-foreground">{t("settings.makePrivateHidesExisting")}</p>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false)
                void apply(false)
              }}
            >
              {t("settings.makePrivate")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
