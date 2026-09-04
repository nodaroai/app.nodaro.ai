import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useT } from "@/lib/i18n"
import {
  useDeploymentBillingUsers,
  useGrantAllowanceMutation,
  useUserGrants,
  type AllowanceGrantKind,
  type DeploymentUserRow,
} from "@/ee/hooks/queries/use-deployment-billing"
import { orDash, parseWhole, unitsInputError, type DisplayUnit } from "./units"
import { ListError } from "./list-error"

/**
 * Block 4 of the billing account's page — every user's allowance, and the
 * per-row top-up.
 *
 * THE FIGURES ARE THE SERVER'S. `granted` / `remaining` / `spent` arrive in
 * display units, already converted; a row with `provisioned: false` has no
 * allowance row yet and those three are the DEFAULT it will be given at its
 * first Generate (D7). Rendering that case as an em dash would be a lie in the
 * expensive direction — it reads as "this person has nothing".
 *
 * RTL (R5): logical properties only, and the remaining/granted pair is three
 * separately labelled fields rather than one `X / Y` string, which inverts.
 */

const PAGE_SIZE = 50

/**
 * The grant note's cap, mirroring `NOTE_MAX_CHARS` in
 * `backend/src/ee/routes/deployment-billing.ts`. The server refuses a longer
 * note with its own code (`note_too_long`) — this is what stops the payer
 * discovering that only after typing it, and it is the reason the route judges
 * the units and the note separately.
 */
const NOTE_MAX_CHARS = 500

/** How close to the cap the remaining-characters hint appears. Always-on it is
 *  noise on a one-line note; absent it, the textarea just stops accepting keys. */
const NOTE_HINT_WITHIN = 50

export function UsersBlock({ unit }: { unit: DisplayUnit | null }) {
  const t = useT()
  const [search, setSearch] = useState("")
  const [offset, setOffset] = useState(0)
  const [openTopup, setOpenTopup] = useState<string | null>(null)
  const [openGrants, setOpenGrants] = useState<string | null>(null)

  const { data, isLoading, isError, refetch } = useDeploymentBillingUsers(true, search, offset, PAGE_SIZE)
  const grants = useUserGrants(openGrants)
  const grant = useGrantAllowanceMutation()

  // A FAILED read has no `data` and `isLoading` false, so these two defaults
  // are what turn "we could not read this" into "there is nothing here". Every
  // consumer of them below is guarded on `isError`.
  const rows = data?.data ?? []
  const total = data?.total ?? 0

  return (
    <section data-testid="users-block" className="rounded-xl border border-border bg-card p-5">
      <h2 className="text-lg font-semibold">{t("billingAdmin.usersTitle")}</h2>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Input
          className="w-72"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setOffset(0)
          }}
          placeholder={t("billingAdmin.searchPlaceholder")}
          aria-label={t("billingAdmin.searchPlaceholder")}
        />
        {/* `0–0 of 0` off a failed read is a second manufactured definite, and
            a more convincing one than the empty sentence: it looks computed.
            The em dash is the same answer `orDash` gives an unreadable cell. */}
        <span data-testid="users-showing" className="text-xs text-muted-foreground">
          {isError
            ? "—"
            : t("billingAdmin.pageShowing", {
                from: total === 0 ? 0 : offset + 1,
                to: Math.min(offset + rows.length, total),
                total,
              })}
        </span>
      </div>

      {isError && <ListError retryTestId="users-retry" onRetry={() => void refetch()} />}

      {!isError && !isLoading && rows.length === 0 && (
        <p className="mt-4 text-sm text-muted-foreground">{t("billingAdmin.usersEmpty")}</p>
      )}

      <div className="mt-4 space-y-2">
        {rows.map((row) => (
          <div
            key={row.id}
            data-testid={`user-row-${row.id}`}
            className="rounded-lg border border-border/60 p-3"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                {/* `profiles` has no `display_name` column — the human-readable
                    name lives in `full_name` (see database.types.ts and
                    routes/me.ts). Rendering a field the route cannot select is
                    also what made the on-screen name unsearchable. */}
                <div className="truncate text-sm font-medium">
                  {row.full_name || row.email || row.id}
                </div>
                <div className="truncate text-xs text-muted-foreground">{row.email ?? ""}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {row.provisioned ? t("billingAdmin.provisioned") : t("billingAdmin.notProvisioned")}
                </div>
              </div>

              {/* Three labelled fields, never "X / Y": under RTL the numbers of
                  a bare pair swap sides and the sentence means the opposite. */}
              <dl data-testid="allowance-figures" className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">{t("billingAdmin.colGranted")}</dt>
                  <dd className="tabular-nums">{orDash(row.granted)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t("billingAdmin.colRemaining")}</dt>
                  <dd className="tabular-nums font-medium">{orDash(row.remaining)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t("billingAdmin.colSpent")}</dt>
                  <dd className="tabular-nums">{orDash(row.spent)}</dd>
                </div>
              </dl>

              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  data-testid={`topup-open-${row.id}`}
                  onClick={() => setOpenTopup(openTopup === row.id ? null : row.id)}
                >
                  {t("billingAdmin.topupOpen")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  data-testid={`grants-open-${row.id}`}
                  onClick={() => setOpenGrants(openGrants === row.id ? null : row.id)}
                >
                  {t("billingAdmin.grantsOpen")}
                </Button>
              </div>
            </div>

            {openTopup === row.id && (
              <TopupForm
                row={row}
                unit={unit}
                pending={grant.isPending}
                // CLOSE ON SUCCESS. `grant_deployment_allowance` has no
                // idempotency, and a form that stays open keeps the amount it
                // just granted and re-enables itself — so a payer who misses
                // the toast grants it a second time, and unwinding that needs
                // a negative correction the RPC refuses once the user has
                // spent past the correct figure. Closing unmounts TopupForm,
                // which resets `units`/`note` for free.
                onSubmit={(units, note) =>
                  grant.mutate({ userId: row.id, units, note }, { onSuccess: () => setOpenTopup(null) })
                }
              />
            )}

            {openGrants === row.id && (
              <div data-testid={`grants-${row.id}`} className="mt-3 border-t border-border/60 pt-3">
                <h3 className="text-sm font-medium">{t("billingAdmin.grantsTitle")}</h3>
                {grants.isLoading && <p className="text-xs text-muted-foreground">{t("billingAdmin.loading")}</p>}
                {grants.isError && (
                  <ListError retryTestId={`grants-retry-${row.id}`} onRetry={() => void grants.refetch()} />
                )}
                {!grants.isError && !grants.isLoading && (grants.data?.grants.length ?? 0) === 0 && (
                  <p className="text-xs text-muted-foreground">{t("billingAdmin.grantsEmpty")}</p>
                )}
                <ul className="mt-2 space-y-1 text-sm">
                  {(grants.data?.grants ?? []).map((g) => (
                    <li key={g.id} className="flex flex-wrap items-baseline gap-x-3">
                      <span className="text-xs text-muted-foreground">{kindLabel(t, g.kind)}</span>
                      <span className="tabular-nums">{orDash(g.units)}</span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(g.createdAt).toLocaleDateString()}
                      </span>
                      {g.note && <span className="text-xs text-muted-foreground">{g.note}</span>}
                    </li>
                  ))}
                </ul>
                {/* Invariant 4: `overrun` rows are audit-only and are excluded
                    from `granted_credits`, so a history that renders them as
                    ordinary lines will not add up to the granted total. */}
                <p className="mt-2 text-xs text-muted-foreground">{t("billingAdmin.overrunNote")}</p>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={offset === 0}
          onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
        >
          {t("billingAdmin.pagePrev")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={offset + rows.length >= total}
          onClick={() => setOffset(offset + PAGE_SIZE)}
        >
          {t("billingAdmin.pageNext")}
        </Button>
      </div>
    </section>
  )
}

function kindLabel(t: ReturnType<typeof useT>, kind: AllowanceGrantKind): string {
  switch (kind) {
    case "default":
      return t("billingAdmin.kindDefault")
    case "topup":
      return t("billingAdmin.kindTopup")
    case "correction":
      return t("billingAdmin.kindCorrection")
    case "overrun":
      return t("billingAdmin.kindOverrun")
  }
}

function TopupForm({
  row,
  unit,
  pending,
  onSubmit,
}: {
  row: DeploymentUserRow
  unit: DisplayUnit | null
  pending: boolean
  onSubmit: (units: number, note: string) => void
}) {
  const t = useT()
  const [units, setUnits] = useState("")
  const [note, setNote] = useState("")
  const [error, setError] = useState<string | null>(null)

  function submit() {
    // A NEGATIVE amount is legal here and becomes a `correction` server-side
    // (Q6): the payer may lower an allowance, and the database refuses — never
    // trims — one that would fall below what is already reserved or spent.
    const reason = unitsInputError(units, unit, { allowNegative: true })
    if (reason !== null) {
      setError(errorText(t, reason, unit))
      return
    }
    setError(null)
    onSubmit(parseWhole(units), note.trim())
  }

  return (
    <div data-testid={`topup-form-${row.id}`} className="mt-3 border-t border-border/60 pt-3">
      <label className="block text-xs text-muted-foreground" htmlFor={`topup-units-${row.id}`}>
        {t("billingAdmin.topupUnits", { unit: unit?.label ?? "" })}
      </label>
      <div className="mt-1 flex flex-wrap items-start gap-2">
        <Input
          id={`topup-units-${row.id}`}
          className="w-40 tabular-nums"
          inputMode="numeric"
          value={units}
          disabled={unit === null}
          onChange={(e) => setUnits(e.target.value)}
        />
        <div className="w-72">
          <Textarea
            className="min-h-9 w-full"
            rows={1}
            maxLength={NOTE_MAX_CHARS}
            value={note}
            placeholder={t("billingAdmin.topupNote")}
            aria-label={t("billingAdmin.topupNote")}
            onChange={(e) => setNote(e.target.value)}
          />
          {/* RTL (R5): a single number inside a translated sentence, never an
              `X / Y` counter — that string inverts, exactly as the
              remaining/granted pair at the top of this file does. */}
          {note.length > NOTE_MAX_CHARS - NOTE_HINT_WITHIN && (
            <p data-testid={`topup-note-left-${row.id}`} className="mt-1 text-xs text-muted-foreground">
              {t("billingAdmin.noteCharsLeft", { n: NOTE_MAX_CHARS - note.length })}
            </p>
          )}
        </div>
        <Button size="sm" data-testid={`topup-submit-${row.id}`} disabled={pending} onClick={submit}>
          {t("billingAdmin.topupSubmit")}
        </Button>
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      <p className="mt-2 text-xs text-muted-foreground">{t("billingAdmin.topupHint")}</p>
    </div>
  )
}

/** The client-side refusal, worded exactly as the server's would be. */
export function errorText(
  t: ReturnType<typeof useT>,
  reason: NonNullable<ReturnType<typeof unitsInputError>>,
  unit: DisplayUnit | null,
): string {
  switch (reason) {
    case "not_whole_credits":
      return t("billingAdmin.errNotWholeCredits", {
        rate: (unit?.rate ?? 1).toLocaleString(),
        unit: unit?.label ?? "",
      })
    case "zero":
      return t("billingAdmin.errZero")
    case "negative":
      return t("billingAdmin.errNegative")
    case "unit_not_configured":
      return t("billingAdmin.errUnitNotConfigured")
    default:
      return t("billingAdmin.errInvalidUnits")
  }
}
