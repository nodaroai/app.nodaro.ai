/**
 * Under the Jobs search box: the accounts whose address or name contains what
 * is typed (`GET /v1/admin/user-lookup`, every account, not a loaded list).
 * The prompt / error search keeps running; picking an account sets the User
 * filter instead. Shown only while the box (or this list) has the focus.
 */
import type { AdminUserLite } from "@/ee/hooks/queries/use-admin-user-lookup"

/** At most this many accounts are offered under the box. */
export const ACCOUNT_SUGGESTIONS = 8

export interface AccountSuggestionsProps {
  readonly accounts: ReadonlyArray<AdminUserLite>
  readonly onPick: (account: AdminUserLite) => void
}

export function AccountSuggestions({ accounts, onPick }: AccountSuggestionsProps) {
  if (accounts.length === 0) return null
  return (
    <div className="absolute end-0 top-full z-50 mt-1 w-[320px] rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
      <p id="jobs-account-suggestions" className="px-2 py-1 text-xs text-muted-foreground">Accounts matching</p>
      <ul aria-labelledby="jobs-account-suggestions">
        {accounts.map((a) => {
          const name = a.fullName?.trim()
          return (
            <li key={a.id}>
              <button
                type="button"
                className="flex w-full flex-col items-start rounded-sm px-2 py-1.5 text-start text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                // Keep the focus in the box's group, so the list does not close before the click lands.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onPick(a)}
              >
                <span className="w-full truncate">{a.email}</span>
                {name && <span className="w-full truncate text-xs text-muted-foreground">{name}</span>}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
