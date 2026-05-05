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

interface UserFilterProps {
  readonly users: ReadonlyArray<UserFilterUser>
  readonly value: UserFilterValue
  readonly onChange: (value: UserFilterValue) => void
  readonly className?: string
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
 */
export function UserFilter({ users, value, onChange, className }: UserFilterProps) {
  const [open, setOpen] = useState(false)
  const label = getTriggerLabel(value, users)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label="Filter by user"
          className={cn("w-[180px] justify-between font-normal", className)}
        >
          <span className="truncate">{label}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[260px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search users…" />
          <CommandList>
            <CommandEmpty>No users found.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="__all"
                onSelect={() => {
                  onChange({ kind: "all" })
                  setOpen(false)
                }}
              >
                <CheckMark active={value.kind === "all"} />
                All users
              </CommandItem>
              <CommandItem
                value="__exclude_admins"
                onSelect={() => {
                  onChange({ kind: "exclude_admins" })
                  setOpen(false)
                }}
              >
                <CheckMark active={value.kind === "exclude_admins"} />
                All users (excl. admins)
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
                      onChange({ kind: "user", id: u.id })
                      setOpen(false)
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
      className={cn("mr-2 h-4 w-4", active ? "opacity-100" : "opacity-0")}
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
): string {
  if (value.kind === "all") return "All users"
  if (value.kind === "exclude_admins") return "Excluding admins"
  const u = users.find((x) => x.id === value.id)
  if (!u) return "Unknown user"
  return formatUserShort(u)
}
