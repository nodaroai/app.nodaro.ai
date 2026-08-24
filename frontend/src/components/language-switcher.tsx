"use client"

import { memo, useState } from "react"
import { Languages, Check } from "lucide-react"
import { LANGUAGES, type LocaleId } from "@nodaro/shared"
import { useLocaleStore } from "@/lib/locale-store"
import { useAuth } from "@/hooks/use-auth"
import { useUpdatePreferredLocaleMutation } from "@/hooks/queries/use-user-settings-queries"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

/**
 * Global app language switcher (sidebar). Unlike the compact config-panel
 * <LocalePicker>, this is a full-width row for the nav. Both write the same
 * locale-store + persist to the profile, so switching here localizes BOTH the
 * app chrome (via useT) AND the picker catalogs.
 */
function LanguageSwitcherComponent({ collapsed }: { readonly collapsed?: boolean }) {
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
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t("lang.pick")}
          title={`${t("lang.label")}: ${current.englishName}`}
          className={cn(
            "flex items-center rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors",
            collapsed ? "justify-center w-full h-9" : "gap-2 w-full px-3 py-2",
          )}
        >
          <Languages className="size-4 shrink-0" />
          {!collapsed && (
            <span className="flex items-center gap-1.5 min-w-0">
              <span className="truncate">{current.nativeName}</span>
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-1" align="start" side="top" sideOffset={4}>
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
