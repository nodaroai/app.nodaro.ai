/**
 * An import of a link refused because a measure on the account is in force
 * (account-measures.ts): an import block, or the account closed. Its own
 * module, so a test that stubs the record's read still meets the real class
 * in the import gate's `isImportRefusal`.
 */
export class AccountMeasureError extends Error {
  readonly code = "imports_blocked" as const
  /** The same answer on a worker's retry, until an administrator lifts it (lib/deterministic-job-error.ts). */
  readonly deterministic = true

  constructor(
    /** When the block ends; null: until an administrator lifts it (or the account is closed). */
    readonly endsAt: string | null,
    readonly closed: boolean,
  ) {
    super(refusalMessage(endsAt, closed))
    this.name = "AccountMeasureError"
  }
}

function refusalMessage(endsAt: string | null, closed: boolean): string {
  if (closed) return "This account is closed, so it cannot import links."
  const until = endsAt ? `until ${new Date(endsAt).toISOString().slice(0, 10)} (UTC)` : "until an administrator lifts the block"
  return `Importing links is blocked on this account ${until}. Content restrictions in your settings says why.`
}
