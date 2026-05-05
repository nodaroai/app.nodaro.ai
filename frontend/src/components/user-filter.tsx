import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"

const ALL_USERS_SENTINEL = "__all"

interface UserFilterProps {
  readonly users: ReadonlyArray<{ id: string; email: string }>
  readonly value: string | null
  readonly onChange: (userId: string | null) => void
  readonly className?: string
}

/**
 * Single-user filter dropdown for admin views.
 *
 * Render only when `users.length > 0` — this component does not no-op for
 * empty input. The caller is responsible for hiding it while data loads.
 *
 * Maps `value === null` ↔ internal sentinel `"__all"` because shadcn `Select`
 * does not accept empty-string values.
 */
export function UserFilter({ users, value, onChange, className }: UserFilterProps) {
  const selectValue = value ?? ALL_USERS_SENTINEL

  const handleChange = (next: string) => {
    onChange(next === ALL_USERS_SENTINEL ? null : next)
  }

  return (
    <Select value={selectValue} onValueChange={handleChange}>
      <SelectTrigger className={cn("w-[180px]", className)} aria-label="Filter by user">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_USERS_SENTINEL}>All users</SelectItem>
        {users.map((u) => (
          <SelectItem key={u.id} value={u.id}>
            {u.email}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
