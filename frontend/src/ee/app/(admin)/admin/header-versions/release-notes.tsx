import { cn } from "@/lib/utils"
import { ENVIRONMENT_LOOK, keepColour, NewTabLink } from "./product-card"
import { ENVIRONMENTS, WHATS_NEW_ID } from "./site-face"
import type { HeaderVersionsReport, ProductView, ReleaseChange, ReleaseNote } from "./types"

/**
 * What changed between the versions on the map: every release newer than the
 * oldest version a site serves, newest first — what it brought, and which
 * sites do not have it yet. A "behind" note on a card links here.
 */

const KIND: Record<ReleaseChange["kind"], { label: string; className: string } | null> = {
  feature: { label: "New", className: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300" },
  fix: { label: "Fix", className: "bg-amber-500/15 text-amber-800 dark:text-amber-300" },
  other: null,
}

const releasedOn = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" })

function Change({ change, small }: { change: ReleaseChange; small: boolean }) {
  const kind = KIND[change.kind]
  return (
    <li className={cn("flex items-start gap-2", small ? "text-xs text-muted-foreground" : "text-sm")}>
      {kind ? <span className={cn("mt-0.5 shrink-0 rounded px-1.5 text-[11px] font-semibold", kind.className)}>{kind.label}</span> : <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-muted-foreground" />}
      <span>
        {change.title}
        {change.url && (
          <>
            {" "}
            <NewTabLink href={change.url} className="font-mono text-xs text-muted-foreground">
              #{change.url.split("/").pop()}
            </NewTabLink>
          </>
        )}
      </span>
    </li>
  )
}

/** The sites without a release, one chip per product, its live and test sites marked as the cards mark them. */
function MissingOn({ note, products }: { note: ReleaseNote; products: readonly ProductView[] }) {
  const missing = products.flatMap((product) => {
    const environments = ENVIRONMENTS.filter((environment) => note.missingOn.some((m) => m.productId === product.id && m.environment === environment))
    return environments.length > 0 ? [{ product, environments }] : []
  })
  // A listed release is newer than the oldest version served, so some site always lacks it.
  if (missing.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted-foreground">Not yet on:</span>
      {missing.map(({ product, environments }) => (
        <span key={product.id} className="inline-flex items-center gap-1.5 rounded-full border bg-card py-0.5 pe-1 ps-2 text-xs font-medium">
          {product.label}
          {environments.map((environment) => (
            <span key={environment} {...keepColour(environment)} className={cn("rounded-full px-1.5 text-[11px] font-semibold uppercase", ENVIRONMENT_LOOK[environment].tag)}>
              {ENVIRONMENT_LOOK[environment].label}
            </span>
          ))}
        </span>
      ))}
    </div>
  )
}

function Release({ note, products }: { note: ReleaseNote; products: readonly ProductView[] }) {
  return (
    <li id={`release-${note.version}`} className="grid gap-x-5 gap-y-2 border-t py-4 first:border-t-0 sm:grid-cols-[8rem_1fr]">
      <div>
        <NewTabLink href={note.url} className="font-mono text-lg font-semibold">
          {note.version}
        </NewTabLink>
        {note.releasedAt && <div className="text-xs text-muted-foreground">{releasedOn(note.releasedAt)}</div>}
      </div>
      <div className="space-y-2.5">
        {note.summary && (
          <p data-testid="release-summary" className="max-w-prose text-sm leading-relaxed">
            {note.summary}
          </p>
        )}
        {note.changes.length > 0 ? (
          <ul className="space-y-1.5" aria-label={note.summary ? "The changes, as their authors titled them" : "The changes"}>
            {note.changes.map((change) => (
              <Change key={change.url ?? change.title} change={change} small={note.summary !== null} />
            ))}
          </ul>
        ) : (
          !note.summary && <p className="text-sm text-muted-foreground">No change described; the link shows its commits.</p>
        )}
        <MissingOn note={note} products={products} />
      </div>
    </li>
  )
}

export function ReleaseNotes({ report }: { report: HeaderVersionsReport }) {
  const notes = report.releaseNotes
  if (notes.status === "not_configured") return null
  return (
    <section id={WHATS_NEW_ID} aria-labelledby={`${WHATS_NEW_ID}-title`} className="mt-8 scroll-mt-6 rounded-xl border bg-card px-5 py-4">
      <h2 id={`${WHATS_NEW_ID}-title`} className="text-base font-bold">
        What changed between the versions
      </h2>
      <p className="text-sm text-muted-foreground">Every release newer than the oldest version a site serves, and the sites that do not have it yet.</p>
      {notes.status === "error" && <p className="mt-3 text-sm text-destructive">{notes.message}</p>}
      {notes.status === "ok" && notes.releases.length === 0 && notes.compared > 0 && (
        <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-400">Every site serves the newest release.</p>
      )}
      {notes.status === "ok" && notes.compared === 0 && <p className="mt-3 text-sm text-muted-foreground">No site's version could be compared with a release yet.</p>}
      {notes.status === "ok" && notes.releases.length > 0 && (
        <ol className="mt-2">
          {notes.releases.map((note) => (
            <Release key={note.version} note={note} products={report.products} />
          ))}
        </ol>
      )}
      {notes.status === "ok" && notes.older > 0 && report.latest.status === "ok" && (
        <p className="border-t pt-3 text-xs text-muted-foreground">
          And {notes.older} older {notes.older === 1 ? "release" : "releases"}:{" "}
          <NewTabLink href={report.latest.tagsUrl}>every release</NewTabLink>.
        </p>
      )}
    </section>
  )
}
