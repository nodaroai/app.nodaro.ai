import { useState } from "react"
import { Check, ChevronsUpDown } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { useT, type TFunction } from "@/lib/i18n"

export type UserFilterValue =
  | { readonly kind: "all" }
  | { readonly kind: "exclude_admins" }
  | { readonly kind: "user"; readonly id: string }

export interface UserFilterUser {
  readonly id: string
  readonly email: string
  readonly fullName: string | null
  readonly role: "user" | "admin" | "super_admin"
}

/**
 * Server search: the caller owns the typed text and answers `users` for it
 * (a search over every account), so the list is not filtered here.
 */
export interface UserFilterSearch {
  readonly term: string
  readonly onTermChange: (term: string) => void
  readonly loading?: boolean
}

interface UserFilterProps {
  /** The accounts offered: the whole list, or (with `search`) the answer for the typed text. */
  readonly users: ReadonlyArray<UserFilterUser>
  readonly value: UserFilterValue
  /** Called with the picked account too, so a caller that searches keeps its address and name. */
  readonly onChange: (value: UserFilterValue, user?: UserFilterUser) => void
  readonly className?: string
  readonly search?: UserFilterSearch
  /** The picked account when it may not be among `users` (a search answers only what was typed). */
  readonly selected?: UserFilterUser | null
}

/**
 * Single-user filter combobox for admin views.
 *
 * Render only when `users.length > 0` — this component does not no-op for
 * empty input. The caller is responsible for hiding it while data loads.
 *
 * Three modes via the `UserFilterValue` union:
 *  - `{ kind: "all" }` — no filter (default)
 *  - `{ kind: "exclude_admins" }` — hide rows owned by admin/super_admin users
 *  - `{ kind: "user", id }` — show only rows owned by this user
 *
 * With `search`, the typed text goes to the caller, which answers `users` from
 * the server: every account can be found, not only those loaded up front.
 */
export function UserFilter({ users, value, onChange, className, search, selected }: UserFilterProps) {
  const [open, setOpen] = useState(false)
  const t = useT()
  const label = getTriggerLabel(value, users, t, selected)
  const noMatch = search !== undefined && search.term.trim().length > 0 && !search.loading && users.length === 0

  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (!v) search?.onTermChange("") }}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={t("adminReview.filterUser")}
          className={cn("w-[180px] justify-between font-normal", className)}
        >
          <span className="truncate">{label}</span>
          <ChevronsUpDown className="ms-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[260px] p-0" align="start">
        <Command shouldFilter={search === undefined}>
          {search ? (
            <CommandInput placeholder={t("misc.searchUsers")} value={search.term} onValueChange={search.onTermChange} />
          ) : (
            <CommandInput placeholder={t("misc.searchUsers")} />
          )}
          <CommandList>
            <CommandEmpty>{t("misc.noUsersFound")}</CommandEmpty>
            {noMatch && <p className="py-2 text-center text-sm text-muted-foreground">{t("misc.noUsersFound")}</p>}
            <CommandGroup>
              <CommandItem
                value="__all"
                onSelect={() => {
                  onChange({ kind: "all" })
                  setOpen(false)
                }}
              >
                <CheckMark active={value.kind === "all"} />
                {t("exec.allUsers")}
              </CommandItem>
              <CommandItem
                value="__exclude_admins"
                onSelect={() => {
                  onChange({ kind: "exclude_admins" })
                  setOpen(false)
                }}
              >
                <CheckMark active={value.kind === "exclude_admins"} />
                {t("misc.allUsersExclAdmins")}
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup>
              {users.map((u) => {
                const display = formatUserFull(u)
                return (
                  <CommandItem
                    key={u.id}
                    value={display}
                    onSelect={() => {
                      onChange({ kind: "user", id: u.id }, u)
                      setOpen(false)
                      search?.onTermChange("")
                    }}
                  >
                    <CheckMark active={value.kind === "user" && value.id === u.id} />
                    <span className="truncate">{display}</span>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function CheckMark({ active }: { readonly active: boolean }) {
  return (
    <Check
      className={cn("me-2 h-4 w-4", active ? "opacity-100" : "opacity-0")}
    />
  )
}

function formatUserShort(u: UserFilterUser): string {
  return u.fullName?.trim() || u.email
}

function formatUserFull(u: UserFilterUser): string {
  const trimmed = u.fullName?.trim()
  return trimmed ? `${trimmed} (${u.email})` : u.email
}

function getTriggerLabel(
  value: UserFilterValue,
  users: ReadonlyArray<UserFilterUser>,
  t: TFunction,
  selected?: UserFilterUser | null,
): string {
  if (value.kind === "all") return t("exec.allUsers")
  if (value.kind === "exclude_admins") return t("misc.excludingAdmins")
  const u = selected?.id === value.id ? selected : users.find((x) => x.id === value.id)
  if (!u) return t("misc.unknownUser")
  return formatUserShort(u)
}
