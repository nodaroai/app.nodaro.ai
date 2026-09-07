import { useState } from "react"
import { AlertTriangle, Check, Copy } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useT } from "@/lib/i18n"
import {
  errorMessageKey,
  isIntegrationKeyLive,
  useIntegrationKeys,
  useMintIntegrationKeyMutation,
  useRevokeIntegrationKeyMutation,
  MAX_LIVE_INTEGRATION_KEYS,
  type IntegrationKey,
} from "@/ee/hooks/queries/use-deployment-billing"
import { dateOrDash } from "./units"
import { ListError } from "./list-error"

/**
 * The Integrations block — the credentials another system authenticates with.
 *
 * A key ADMINISTERS and READS: it may set allowances, read the pool and read
 * usage. It can never start a run and never buy credits, and it is refused
 * outright on every path outside the billing surface. That asymmetry is what
 * the copy has to convey without overclaiming: a leaked key cannot move money,
 * it can mis-allocate quotas, and that is reversible from this very page.
 *
 * THE BEARER IS SHOWN ONCE. It exists in exactly one response body, and the
 * only recovery from losing it is to revoke and mint again — so the panel that
 * renders it says so in words, is dismissed deliberately rather than by a
 * timer, and resets the mutation on dismissal so nothing on the page still
 * holds the value. The list beside it carries a PREFIX and nothing else.
 *
 * REVOKING ASKS TWICE. It stops a running integration on its next request and
 * cannot be undone; a single misplaced click is too cheap for that.
 *
 * RTL (R5): logical properties only (`ms-`/`me-`/`ps-`/`pe-`/`text-start`), no
 * `rtl:` variant, and no bare `X / Y` counter. The bearer, the prefix and the
 * CIDR ranges are Latin technical strings inside an otherwise Hebrew page and
 * are marked `dir="ltr"`: the bidi algorithm reorders such a run around its own
 * punctuation, so an unmarked one is not what was minted.
 */

/** The mint route's own cap on `allowed_cidrs`. An egress allow-list, not a
 *  routing table — mirrored here so the payer learns it while typing. */
const MAX_CIDRS = 20

/** The route's `KEY_NAME_MAX`. Mirrored for the `maxLength` below, which is
 *  what actually keeps an over-long name off the wire: the server answers
 *  `invalid_name` for BOTH an empty name and an over-long one, so a 400 from
 *  here would render "give the key a name" at a payer who gave it far too much
 *  of one. The guard in `submit` is belt for a form filled programmatically. */
const MAX_NAME = 80

export function IntegrationsBlock() {
  const t = useT()
  const keys = useIntegrationKeys(true)
  const mint = useMintIntegrationKeyMutation()
  const revoke = useRevokeIntegrationKeyMutation()

  const [name, setName] = useState("")
  const [expiry, setExpiry] = useState("")
  const [cidrs, setCidrs] = useState("")
  const [localError, setLocalError] = useState<string | null>(null)

  const rows = keys.data ?? []
  const live = rows.filter((k) => isIntegrationKeyLive(k)).length

  // The SERVER's refusal and the page's own share one line, because they are
  // the same event to the payer: the key was not created, and here is why.
  const error = localError ?? (mint.error ? t(errorMessageKey(mint.error)) : null)

  function submit() {
    const trimmedName = name.trim()
    if (trimmedName === "") {
      setLocalError(t("billingAdmin.errInvalidName"))
      return
    }
    if (trimmedName.length > MAX_NAME) {
      setLocalError(t("billingAdmin.errNameTooLong", { max: MAX_NAME }))
      return
    }

    let expiresAt: string | undefined
    if (expiry.trim() !== "") {
      // `<input type="date">` holds `yyyy-mm-dd`, which parses as MIDNIGHT UTC
      // — already in the past for much of the world on the day it is picked,
      // and the route refuses a past expiry. Send the END of the chosen day in
      // the payer's own zone, which is what "expires on that date" means.
      const chosen = new Date(`${expiry.trim()}T23:59:59`)
      if (Number.isNaN(chosen.getTime()) || chosen.getTime() <= Date.now()) {
        setLocalError(t("billingAdmin.errInvalidExpiry"))
        return
      }
      expiresAt = chosen.toISOString()
    }

    // Commas AND newlines: a payer pasting from a firewall config gets either.
    const ranges = cidrs
      .split(/[\n,]/)
      .map((c) => c.trim())
      .filter((c) => c.length > 0)
    if (ranges.length > MAX_CIDRS) {
      setLocalError(t("billingAdmin.errTooManyCidrs", { max: MAX_CIDRS }))
      return
    }

    setLocalError(null)
    // The SHAPE is deliberately sparse: an absent key means "no restriction",
    // and sending `expiresAt: null` / `allowedCidrs: []` would ask the route to
    // decide whether those mean the same thing.
    mint.mutate(
      {
        name: trimmedName,
        ...(expiresAt ? { expiresAt } : {}),
        ...(ranges.length > 0 ? { allowedCidrs: ranges } : {}),
      },
      {
        // EMPTIED ON SUCCESS, together with the disabled button below. A form
        // that still holds the values it was minted from is one click away
        // from minting a near-duplicate — and that click would replace the
        // bearer the panel is still showing, discarding a key the payer had
        // not copied yet.
        onSuccess: () => {
          setName("")
          setExpiry("")
          setCidrs("")
        },
      },
    )
  }

  return (
    <section data-testid="integrations-block" className="rounded-xl border border-border bg-card p-5">
      <h2 className="text-lg font-semibold">{t("billingAdmin.integrationsTitle")}</h2>
      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
        {t("billingAdmin.integrationsNote")}
      </p>

      {/* The copy-once panel sits ABOVE the form: it is what the payer must act
          on, and pushing it below a list of five rows is how a bearer goes
          unread. */}
      {mint.data && (
        <div
          data-testid="integration-token"
          className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4"
        >
          <h3 className="text-sm font-medium">{t("billingAdmin.integrationsTokenTitle")}</h3>
          <p className="mt-1 max-w-3xl text-sm text-amber-800 dark:text-amber-300">
            {t("billingAdmin.integrationsTokenOnce")}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <code
              data-testid="integration-token-value"
              dir="ltr"
              className="min-w-0 break-all rounded bg-background px-2 py-1 text-xs"
            >
              {mint.data.token}
            </code>
            <CopyButton value={mint.data.token} />
            <Button
              size="sm"
              variant="outline"
              data-testid="integration-token-done"
              // RESET, not just a hide: the mutation's `data` is the only place
              // the bearer lives, and dismissing the panel has to empty it
              // rather than merely stop painting it.
              onClick={() => mint.reset()}
            >
              {t("billingAdmin.integrationsTokenDone")}
            </Button>
          </div>
        </div>
      )}

      {/* ── Mint ──────────────────────────────────────────────────────────── */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-xs text-muted-foreground" htmlFor="integration-name">
            {t("billingAdmin.integrationsName")}
          </label>
          <Input
            id="integration-name"
            data-testid="integration-name"
            className="mt-1"
            maxLength={MAX_NAME}
            value={name}
            placeholder={t("billingAdmin.integrationsNamePlaceholder")}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs text-muted-foreground" htmlFor="integration-expiry">
            {t("billingAdmin.integrationsExpiry")}
          </label>
          <Input
            id="integration-expiry"
            data-testid="integration-expiry"
            className="mt-1"
            type="date"
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            {t("billingAdmin.integrationsExpiryHint")}
          </p>
        </div>
        <div className="sm:col-span-2">
          <label className="block text-xs text-muted-foreground" htmlFor="integration-cidrs">
            {t("billingAdmin.integrationsCidrs")}
          </label>
          <Textarea
            id="integration-cidrs"
            data-testid="integration-cidrs"
            dir="ltr"
            className="mt-1 min-h-16 text-start"
            rows={2}
            value={cidrs}
            onChange={(e) => setCidrs(e.target.value)}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            {t("billingAdmin.integrationsCidrsHint", { max: MAX_CIDRS })}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        {/* DISABLED WHILE THE PANEL IS UP. The bearer exists in exactly one
            response body and lives only in `mint.data`; a second mint would
            overwrite it with a new one and the first — uncopied — would be
            unrecoverable. Dismissing the panel resets the mutation, which is
            what re-enables this. */}
        <Button
          size="sm"
          data-testid="integration-mint"
          disabled={mint.isPending || !!mint.data}
          onClick={submit}
        >
          {t("billingAdmin.integrationsMint")}
        </Button>
        {/* One number inside a sentence, never `3 / 5`: a bare pair inverts
            under RTL and then says the opposite. */}
        <span data-testid="integration-count" className="text-xs text-muted-foreground tabular-nums">
          {t("billingAdmin.integrationsCount", { n: live, max: MAX_LIVE_INTEGRATION_KEYS })}
        </span>
      </div>

      {/* INLINE, not a toast. The payer meeting `key_limit_reached` is looking
          at the list they have to revoke from, and the answer belongs beside
          the button that refused. */}
      {error && (
        <p role="alert" data-testid="integration-error" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}

      {/* ── The list ──────────────────────────────────────────────────────── */}
      {keys.isError && <ListError retryTestId="integrations-retry" onRetry={() => void keys.refetch()} />}

      {!keys.isError && !keys.isLoading && rows.length === 0 && (
        <p className="mt-4 text-sm text-muted-foreground">{t("billingAdmin.integrationsEmpty")}</p>
      )}

      <div data-testid="integration-list" className="mt-4 space-y-2">
        {rows.map((k) => (
          <KeyRow
            key={k.id}
            k={k}
            pending={revoke.isPending}
            onRevoke={() => revoke.mutate({ id: k.id })}
          />
        ))}
      </div>
    </section>
  )
}

function KeyRow({
  k,
  pending,
  onRevoke,
}: {
  k: IntegrationKey
  pending: boolean
  onRevoke: () => void
}) {
  const t = useT()
  const [confirming, setConfirming] = useState(false)
  // The list's own predicate, never a second copy of it: `isIntegrationKeyLive`
  // is what counts the keys against the cap a few lines up, and a row that
  // disagreed with the counter about which keys are dead would be the harder
  // bug to see.
  const expired = !k.revokedAt && !isIntegrationKeyLive(k)

  return (
    <div
      data-testid={`integration-key-${k.id}`}
      className="rounded-lg border border-border/60 p-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{k.name}</div>
          {/* The PREFIX, which is what a log line carries. It is not a
              credential and cannot be used as one. */}
          <code dir="ltr" className="mt-0.5 block truncate text-xs text-muted-foreground">
            {k.tokenPrefix}
          </code>
          {k.revokedAt && (
            <div className="mt-1 text-xs text-destructive">
              {t("billingAdmin.integrationsRevokedAt")} {dateOrDash(k.revokedAt)}
            </div>
          )}
          {expired && (
            <div className="mt-1 text-xs text-muted-foreground">
              {t("billingAdmin.integrationsExpired")}
            </div>
          )}
        </div>

        {/* Separately labelled fields rather than one run-on line: the dates
            invert around each other under RTL when they share a sentence. */}
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">
              {t("billingAdmin.integrationsColCreated")}
            </dt>
            <dd className="text-xs tabular-nums">{dateOrDash(k.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">
              {t("billingAdmin.integrationsColLastUsed")}
            </dt>
            <dd className="text-xs tabular-nums">
              {k.lastUsedAt ? dateOrDash(k.lastUsedAt) : t("billingAdmin.integrationsNeverUsed")}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">
              {t("billingAdmin.integrationsColExpires")}
            </dt>
            <dd className="text-xs tabular-nums">
              {k.expiresAt ? dateOrDash(k.expiresAt) : t("billingAdmin.integrationsNoExpiry")}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">
              {t("billingAdmin.integrationsColSources")}
            </dt>
            <dd data-cidr dir="ltr" className="text-xs">
              {k.allowedCidrs && k.allowedCidrs.length > 0
                ? k.allowedCidrs.join(", ")
                : t("billingAdmin.integrationsAnySource")}
            </dd>
          </div>
        </dl>

        {/* A revoked key has nothing left to revoke; offering the button again
            would only invite a 404. */}
        {!k.revokedAt && !confirming && (
          <Button
            size="sm"
            variant="outline"
            data-testid={`integration-revoke-${k.id}`}
            onClick={() => setConfirming(true)}
          >
            {t("billingAdmin.integrationsRevoke")}
          </Button>
        )}
      </div>

      {confirming && (
        <div className="mt-3 border-t border-border/60 pt-3">
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
            {t("billingAdmin.integrationsRevokeWarn")}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="destructive"
              data-testid={`integration-revoke-confirm-${k.id}`}
              // The Revoke button UNMOUNTS when this panel opens, so focus
              // would fall back to the document body and a keyboard payer
              // would have to find their way back to the row they were on.
              // It moves to the destructive action, which is also what a
              // screen reader then announces.
              autoFocus
              disabled={pending}
              onClick={() => {
                setConfirming(false)
                onRevoke()
              }}
            >
              {t("billingAdmin.integrationsRevokeConfirm")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              data-testid={`integration-revoke-cancel-${k.id}`}
              onClick={() => setConfirming(false)}
            >
              {t("billingAdmin.integrationsRevokeCancel")}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Copy, with the browser's refusal treated as normal rather than exceptional.
 *
 * `navigator.clipboard` is absent on an insecure origin and in any embedded
 * view that withholds it, and `writeText` rejects when the document is not
 * focused. Either way the bearer stays on screen for the payer to select by
 * hand — the one thing the handler must never do is throw and take the panel
 * holding the only copy of the key down with it.
 */
function CopyButton({ value }: { value: string }) {
  const t = useT()
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard?.writeText(value)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <Button size="sm" variant="outline" data-testid="integration-copy" onClick={() => void copy()}>
      {copied ? <Check className="me-1.5 h-3.5 w-3.5" /> : <Copy className="me-1.5 h-3.5 w-3.5" />}
      {/* The label is the ONLY confirmation that the bearer reached the
          clipboard, and a label that changes silently confirms nothing to a
          screen reader. Polite, not assertive: it must not interrupt the
          sentence saying the key is shown once. */}
      <span aria-live="polite">
        {copied ? t("billingAdmin.integrationsCopied") : t("billingAdmin.integrationsCopy")}
      </span>
    </Button>
  )
}
