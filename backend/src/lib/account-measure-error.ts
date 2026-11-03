/**
 * An import of a link refused because a measure on the account is in force
 * (account-measures.ts): an import block, the account suspended, or the
 * account closed. Its own module, so a test that stubs the record's read
 * still meets the real class in the import gate's `isImportRefusal`.
 */
export class AccountMeasureError extends Error {
  readonly code = "imports_blocked" as const
  /** The same answer on a worker's retry, until an administrator lifts it (lib/deterministic-job-error.ts). */
  readonly deterministic = true

  constructor(
    /** When the measure ends; null: until an administrator lifts it (an import block with no end, a closure). */
    readonly endsAt: string | null,
    /** The measure that refuses it. */
    readonly measure: "imports_blocked" | "suspended" | "closed",
  ) {
    super(refusalMessage(endsAt, measure))
    this.name = "AccountMeasureError"
  }
}

function refusalMessage(endsAt: string | null, measure: AccountMeasureError["measure"]): string {
  if (measure === "closed") return "This account is closed, so it cannot import links."
  const date = endsAt ? `${new Date(endsAt).toISOString().slice(0, 10)} (UTC)` : null
  if (measure === "suspended") return `This account is suspended${date ? ` until ${date}` : ""}, so it cannot import links.`
  const until = date ? `until ${date}` : "until an administrator lifts the block"
  return `Importing links is blocked on this account ${until}. Content restrictions in your settings says why.`
}
