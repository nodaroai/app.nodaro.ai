"use client"

import { useMemo, useState } from "react"
import { Check, ChevronsUpDown } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { useT } from "@/lib/i18n"
import type { LanguageOption } from "@/lib/audio-tags"

/**
 * A searchable language combobox (Popover + cmdk — the `LlmModelSelect` /
 * `ModelSearchSelect` pattern) for the 46-item language list, which is too
 * long for a plain Select: no search, and finding one language means reading
 * the whole menu (user report, 2026-08-31). The options arrive already
 * alphabetized (`audio-tags.ts` sorts every exported list); this adds the
 * type-to-filter on top.
 *
 * `allLabel` renders an optional leading "any" row bound to the sentinel
 * `allValue` — the voice browser's filter semantics ("All" = don't filter).
 * Omit `allLabel` for pickers where a language is mandatory (dubbing target).
 * `allLabel` / `ariaLabel` arrive already localized from the caller; `ariaLabel`
 * falls back to the localized "Language".
 */
export function LanguageSearchSelect({
  value,
  onChange,
  options,
  ariaLabel,
  allLabel,
  allValue = "All",
  className,
  /** Portal stacking class — this picker mounts inside dialogs (Browse
   *  Voices); the stock z-50 lands under them. Same blanket LlmModelSelect uses. */
  zClassName = "z-[9999]",
}: {
  readonly value: string
  readonly onChange: (value: string) => void
  readonly options: LanguageOption[]
  readonly ariaLabel?: string
  readonly allLabel?: string
  readonly allValue?: string
  readonly className?: string
  readonly zClassName?: string
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")

  const ariaText = ariaLabel ?? t("lang.label")
  const current = options.find((o) => o.value === value)
  const triggerLabel = current?.label ?? allLabel ?? ariaText

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q))
  }, [options, query])

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) setQuery("")
  }

  const pick = (next: string) => {
    onChange(next)
    handleOpenChange(false)
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaText}
          className={cn("h-7 justify-between px-2 text-xs font-normal", className)}
        >
          <span className="truncate">{triggerLabel}</span>
          <ChevronsUpDown className="ms-1 size-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className={cn("w-[220px] p-0", zClassName)}>
        <Command shouldFilter={false} className="bg-transparent">
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={t("cfgext.langSelSearch")}
            className="placeholder:text-muted-foreground/50"
          />
          <CommandList>
            {allLabel && !query.trim() && (
              <CommandItem value={allValue} onSelect={() => pick(allValue)}>
                <Check className={cn("me-1 size-3.5", value === allValue ? "opacity-100" : "opacity-0")} />
                {allLabel}
              </CommandItem>
            )}
            {visible.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">{t("cfgext.langSelNoMatch")}</div>
            ) : (
              visible.map((o) => (
                <CommandItem key={o.value} value={o.value} onSelect={() => pick(o.value)}>
                  <Check className={cn("me-1 size-3.5", value === o.value ? "opacity-100" : "opacity-0")} />
                  {o.label}
                </CommandItem>
              ))
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
