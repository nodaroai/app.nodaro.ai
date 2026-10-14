"use client"

import { useMemo, useState } from "react"
import { Check, ChevronsUpDown } from "lucide-react"
import { isValidTimezone, timezoneOffsetMinutes } from "@nodaro/shared/workflow"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { useT } from "@/lib/i18n"

/** For a runtime without `Intl.supportedValuesOf` — the zones people ask for most. */
const FALLBACK_ZONES = [
  "UTC", "Asia/Jerusalem", "Europe/London", "Europe/Paris", "Europe/Berlin", "Europe/Madrid", "Europe/Moscow",
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Toronto", "America/Sao_Paulo",
  "Asia/Dubai", "Asia/Kolkata", "Asia/Singapore", "Asia/Shanghai", "Asia/Tokyo", "Asia/Seoul", "Australia/Sydney",
]

/** Every timezone this browser can read the clock in, UTC first. */
export function allTimezones(): string[] {
  try {
    const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone")
    if (supported && supported.length > 0) return supported.includes("UTC") ? ["UTC", ...supported.filter((z) => z !== "UTC")] : ["UTC", ...supported]
  } catch {
    // fall through
  }
  return FALLBACK_ZONES
}

/** The browser's own zone, when it is one the runtime can read. */
export function browserTimezone(): string | null {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    return zone && isValidTimezone(zone) ? zone : null
  } catch {
    return null
  }
}

/** "UTC+3" / "UTC-4:30" — the zone's offset right now. */
export function timezoneOffsetLabel(zone: string, now: Date = new Date()): string {
  const minutes = timezoneOffsetMinutes(now, zone)
  const sign = minutes < 0 ? "-" : "+"
  const abs = Math.abs(minutes)
  const rest = abs % 60
  return `UTC${sign}${Math.floor(abs / 60)}${rest ? `:${String(rest).padStart(2, "0")}` : ""}`
}

/**
 * A searchable timezone combobox (Popover + cmdk — the `LanguageSearchSelect`
 * pattern) over every IANA zone, the browser's own zone offered first.
 */
export function TimezoneSelect({
  value,
  onChange,
  className,
  zones: zonesProp,
}: {
  readonly value: string
  readonly onChange: (zone: string) => void
  readonly className?: string
  /** The zones to offer; every zone the browser knows when omitted (a test seam — 400+ rows are slow in jsdom, not in a browser). */
  readonly zones?: ReadonlyArray<string>
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const zones = useMemo(() => zonesProp ?? allTimezones(), [zonesProp])
  const mine = useMemo(() => browserTimezone(), [])
  // A zone the runtime cannot read (an old free-text value such as "Israel
  // Time") is shown as the problem it is — the server parks such a schedule.
  const readable = isValidTimezone(value)

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/\s+/g, "_")
    if (!q) return zones
    return zones.filter((z) => z.toLowerCase().includes(q))
  }, [zones, query])

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) setQuery("")
  }

  const pick = (zone: string) => {
    onChange(zone)
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
          aria-label={t("cfgext.trigTimezone")}
          aria-invalid={!readable}
          className={cn("w-full h-9 justify-between px-3 text-sm font-normal", !readable && "border-destructive text-destructive", className)}
        >
          <span className="truncate">{value}</span>
          <span className={cn("ms-2 flex items-center gap-1.5 text-xs", readable ? "text-muted-foreground" : "text-destructive")}>
            {readable ? timezoneOffsetLabel(value) : "?"}
            <ChevronsUpDown className="size-3.5 opacity-50" />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[300px] p-0 z-[9999]">
        <Command shouldFilter={false} className="bg-transparent">
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={t("sched.searchTimezone")}
            className="placeholder:text-muted-foreground/50"
          />
          <CommandList className="max-h-[260px]">
            {mine && mine !== value && !query.trim() && (
              <CommandItem value={`mine:${mine}`} onSelect={() => pick(mine)} className="flex items-center">
                <Check className="me-1 size-3.5 opacity-0" />
                <span className="flex-1 truncate">{mine}</span>
                <span className="text-[10px] uppercase tracking-wider text-[#ff0073]">{t("sched.yourTimezone")}</span>
              </CommandItem>
            )}
            {visible.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">{t("sched.noTimezoneMatch")}</div>
            ) : (
              visible.map((zone) => (
                <CommandItem key={zone} value={zone} onSelect={() => pick(zone)} className="flex items-center">
                  <Check className={cn("me-1 size-3.5", value === zone ? "opacity-100" : "opacity-0")} />
                  <span className="flex-1 truncate">{zone}</span>
                  <span className="text-xs text-muted-foreground">{timezoneOffsetLabel(zone)}</span>
                </CommandItem>
              ))
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
