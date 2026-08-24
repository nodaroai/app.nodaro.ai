"use client"

import { memo, useState } from "react"
import { Languages, Check } from "lucide-react"
import { LANGUAGES, type LocaleId } from "@nodaro/shared"
import { useLocaleStore } from "@/lib/locale-store"
import { useAuth } from "@/hooks/use-auth"
import { useUpdatePreferredLocaleMutation } from "@/hooks/queries/use-user-settings-queries"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

/**
 * Global app language switcher (sidebar footer). A compact icon button that
 * sits beside the theme toggle; hovering shows the current language, clicking
 * opens the language menu. Unlike the compact config-panel <LocalePicker>, this
 * writes the same locale-store + persists to the profile, so switching here
 * localizes BOTH the app chrome (via useT) AND the picker catalogs.
 * Must be rendered inside a <TooltipProvider> (the sidebar supplies one).
 */
function LanguageSwitcherComponent() {
  const t = useT()
  const locale = useLocaleStore((s) => s.locale)
  const setLocale = useLocaleStore((s) => s.setLocale)
  const { user } = useAuth()
  const userId = user?.id
  const update = useUpdatePreferredLocaleMutation()
  const [open, setOpen] = useState(false)

  const current = LANGUAGES.find((l) => l.id === locale) ?? LANGUAGES[0]

  function handlePick(next: LocaleId) {
    setLocale(next)
    if (userId) update.mutate({ userId, preferredLocale: next })
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={t("lang.pick")}>
              <Languages className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          className="bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white border-zinc-200 dark:border-zinc-700"
        >
          {`${t("lang.label")}: ${current.englishName}`}
        </TooltipContent>
      </Tooltip>
      <PopoverContent className="w-56 p-1" align="end" side="top" sideOffset={4}>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground px-2 py-1.5 select-none">
          {t("lang.label")}
        </div>
        <div className="flex flex-col gap-0.5">
          {LANGUAGES.map((lang) => {
            const selected = lang.id === locale
            return (
              <button
                key={lang.id}
                type="button"
                onClick={() => handlePick(lang.id)}
                className={cn(
                  "flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-xs hover:bg-muted/60 cursor-pointer transition-colors text-left",
                  selected && "bg-muted/40",
                )}
                dir={lang.dir}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <span className="flex flex-col min-w-0">
                    <span className="text-foreground font-medium truncate">{lang.nativeName}</span>
                    {lang.nativeName !== lang.englishName && (
                      <span className="text-muted-foreground text-[10px] truncate">{lang.englishName}</span>
                    )}
                  </span>
                </span>
                {selected && <Check className="size-3.5 text-[#ff0073] shrink-0" />}
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export const LanguageSwitcher = memo(LanguageSwitcherComponent)
