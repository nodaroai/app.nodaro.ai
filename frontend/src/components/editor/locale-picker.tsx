"use client"

import { memo, useState } from "react"
import { Languages, Check } from "lucide-react"
import { LANGUAGES, type LocaleId } from "@nodaro-shared/i18n"
import { useLocaleStore } from "@/lib/locale-store"
import { useAuth } from "@/hooks/use-auth"
import { useUpdatePreferredLocaleMutation } from "@/hooks/queries/use-user-settings-queries"
import { cn } from "@/lib/utils"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"

/**
 * Compact globe + short-code button that opens a dropdown of all supported
 * languages. Lives inside parameter-node config panels next to the picker
 * grid. Optimistic local update + persisted to user profile via PATCH
 * /v1/user/settings.
 */
function LocalePickerComponent({ className }: { readonly className?: string }) {
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
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Pick picker language"
          title={`Picker language: ${current.englishName}`}
          className={cn(
            "h-7 px-2 gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground",
            className,
          )}
        >
          <Languages className="size-3.5" />
          <span className="text-[11px] tracking-wider">{current.shortCode}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-56 p-1"
        align="end"
        sideOffset={4}
      >
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground px-2 py-1.5 select-none">
          Picker language
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
                  <span className="text-base leading-none shrink-0" aria-hidden="true">
                    {lang.flag}
                  </span>
                  <span className="flex flex-col min-w-0">
                    <span className="text-foreground font-medium truncate">{lang.nativeName}</span>
                    {lang.nativeName !== lang.englishName && (
                      <span className="text-muted-foreground text-[10px] truncate">
                        {lang.englishName}
                      </span>
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

export const LocalePicker = memo(LocalePickerComponent)
