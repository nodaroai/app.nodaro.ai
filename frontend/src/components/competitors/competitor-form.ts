import {
  COMPETITOR_ACCOUNT_KEYS,
  COMPETITOR_DEFAULT_ABOUT_PLATFORMS,
  normalizeSearchTerms,
  type CompetitorAboutPlatform,
  type CompetitorAccountKey,
  type CompetitorDiscovery,
  type CompetitorLimits,
  type CompetitorSchedule,
  type CreateCompetitorInput,
  type TrackedCompetitor,
  type UpdateCompetitorInput,
} from "@nodaro/shared/social"

/**
 * The brand form as data: its state, what it sends, and what an edit
 * changes. Pure, so the dialog and its tests share it.
 */

export interface CompetitorFormState {
  readonly brand: string
  readonly website: string
  readonly accounts: Readonly<Record<CompetitorAccountKey, string>>
  readonly guessed: ReadonlySet<CompetitorAccountKey>
  readonly aboutPlatforms: readonly CompetitorAboutPlatform[]
  readonly schedule: CompetitorSchedule
  readonly isOwn: boolean
  /** Phrases or #hashtags searched instead of the name (empty: the name). */
  readonly searchTerms: readonly string[]
}

const EMPTY_ACCOUNTS = Object.fromEntries(COMPETITOR_ACCOUNT_KEYS.map((k) => [k, ""])) as Record<CompetitorAccountKey, string>

/** A new brand's form: no name, no accounts, the default platforms, weekly. */
export function emptyForm(): CompetitorFormState {
  return {
    brand: "",
    website: "",
    accounts: EMPTY_ACCOUNTS,
    guessed: new Set(),
    aboutPlatforms: COMPETITOR_DEFAULT_ABOUT_PLATFORMS,
    schedule: "weekly",
    isOwn: false,
    searchTerms: [],
  }
}

/** A tracked brand's form, to edit it. */
export function formFrom(c: TrackedCompetitor): CompetitorFormState {
  return {
    brand: c.brand,
    website: c.website,
    accounts: { ...EMPTY_ACCOUNTS, ...c.accounts },
    guessed: new Set(),
    aboutPlatforms: c.aboutPlatforms,
    schedule: c.schedule,
    isOwn: c.isOwn,
    searchTerms: c.searchTerms ?? [],
  }
}

/**
 * The form as the API's input: accounts trimmed, empty ones left out, the
 * website "" when none was given. `withTerms`: the server takes search terms
 * (it sent the plan's limits); an older one is sent none.
 */
export function inputFrom(form: CompetitorFormState, withTerms = false): CreateCompetitorInput {
  const accounts = Object.fromEntries(COMPETITOR_ACCOUNT_KEYS.flatMap((k) => (form.accounts[k].trim() ? [[k, form.accounts[k].trim()]] : [])))
  return {
    brand: form.brand.trim(),
    website: form.website.trim(),
    accounts,
    aboutPlatforms: [...form.aboutPlatforms],
    schedule: form.schedule,
    isOwn: form.isOwn,
    ...(withTerms ? { searchTerms: normalizeSearchTerms(form.searchTerms) } : {}),
  }
}

/** The terms in the same order (a scan searches the first ones the plan allows, so order counts). */
function sameTerms(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((term, i) => term === b[i])
}

/** The plan's cap on terms: 0 (the name only) from a server that sent no limits, null (no cap) when unlimited. */
export function termCapOf(limits: CompetitorLimits | null | undefined): number | null {
  return limits ? limits.searchTerms : 0
}

/**
 * A website lookup folded into the form as it is NOW: only empty account
 * fields are filled, so anything typed meanwhile stays, and earlier guesses
 * keep their badge.
 */
export function mergeDiscovery(cur: CompetitorFormState, found: CompetitorDiscovery): CompetitorFormState {
  const fills = COMPETITOR_ACCOUNT_KEYS.flatMap((key) => {
    const hit = found.accounts[key]
    return hit && !cur.accounts[key].trim() ? [{ key, hit }] : []
  })
  return {
    ...cur,
    brand: cur.brand.trim() ? cur.brand : found.brand,
    website: found.website,
    accounts: { ...cur.accounts, ...Object.fromEntries(fills.map(({ key, hit }) => [key, hit.value])) },
    guessed: new Set([...cur.guessed, ...fills.filter(({ hit }) => hit.from === "guess").map(({ key }) => key)]),
  }
}

function sameAccounts(a: Readonly<Record<string, string | undefined>>, b: Readonly<Record<string, string | undefined>>): boolean {
  return COMPETITOR_ACCOUNT_KEYS.every((key) => (a[key] ?? "") === (b[key] ?? ""))
}

/**
 * What an edit changes, field by field. Sending an unchanged schedule would
 * restart the brand's schedule (its next scan moves a full period out), and
 * an unchanged account set is left alone too.
 */
export function changedFields(before: TrackedCompetitor, input: CreateCompetitorInput): UpdateCompetitorInput {
  const about = input.aboutPlatforms ?? []
  const sameAbout = about.length === before.aboutPlatforms.length && about.every((p) => before.aboutPlatforms.includes(p))
  return {
    ...(input.brand !== before.brand ? { brand: input.brand } : {}),
    ...(input.website !== undefined && input.website !== before.website ? { website: input.website } : {}),
    ...(input.accounts !== undefined && !sameAccounts(before.accounts, input.accounts) ? { accounts: input.accounts } : {}),
    ...(input.aboutPlatforms !== undefined && !sameAbout ? { aboutPlatforms: input.aboutPlatforms } : {}),
    ...(input.schedule !== undefined && input.schedule !== before.schedule ? { schedule: input.schedule } : {}),
    ...(input.isOwn !== undefined && input.isOwn !== before.isOwn ? { isOwn: input.isOwn } : {}),
    ...(input.searchTerms !== undefined && !sameTerms(before.searchTerms ?? [], input.searchTerms) ? { searchTerms: input.searchTerms } : {}),
  }
}
