import {
  createContactProperty,
  isLoopsConfigured,
  listCustomContactProperties,
  LOOPS_LANGUAGE_PROPERTY,
  type LoopsContactPropertyDef,
  type LoopsPropertyType,
} from "./loops-client.js"

/**
 * Making sure a custom Loops contact property exists before we write to it.
 *
 * Loops accepts a value for a custom property only once the property exists in
 * the account, and what it does with a value for one that does not is not
 * documented. The contact update that carries it is also the one that carries
 * the `subscribed` state — the thing the consent mirror is for — so a missing
 * property must never be able to fail that update. Hence the shape:
 *
 *  - `ensure()` answers `true` only when the property is confirmed to exist
 *    (found in the account's list, or created). The caller sends the value
 *    only on `true` and sends the rest of the contact either way.
 *  - It never throws. A problem is logged and answered `false`.
 *  - A confirmation is remembered for the life of the process; a failure is
 *    not remembered for good — it is left alone for a few minutes (so an
 *    outage does not turn every sync into three more calls) and then asked
 *    again, so a process never stays on "no language" for days.
 */

/** How long to leave Loops alone after an attempt failed. */
const RETRY_AFTER_FAILURE_MS = 5 * 60_000

export interface PropertyEnsurer {
  /** `true` once the property exists in the Loops account. Never throws, never rejects. */
  ensure(): Promise<boolean>
  /** Forget a confirmation — Loops refused a value for the property, so look again next time. */
  forget(): void
}

export function createPropertyEnsurer(name: string, type: LoopsPropertyType): PropertyEnsurer {
  let confirmed = false
  let failedAt: number | null = null
  let inFlight: Promise<boolean> | null = null

  const succeed = (): boolean => {
    confirmed = true
    failedAt = null
    return true
  }

  const fail = (reason: string): boolean => {
    failedAt = Date.now()
    console.warn(`[loops-properties] contact property "${name}" is not available, so it is left out of the contact update: ${reason}`)
    return false
  }

  /** What the account has under this name; `null` = could not tell. */
  const lookUp = async (): Promise<{ found: LoopsContactPropertyDef | null } | null> => {
    const listed = await listCustomContactProperties()
    if (!listed.ok || !listed.properties) return null
    return { found: listed.properties.find((property) => property.key === name) ?? null }
  }

  // A property of the right name but another type would refuse every value we
  // send it, so a name match alone is not a confirmation.
  const confirm = (found: LoopsContactPropertyDef): boolean =>
    found.type === type ? succeed() : fail(`it already exists in the account as type "${found.type}", not "${type}"`)

  const attempt = async (): Promise<boolean> => {
    try {
      const before = await lookUp()
      if (before === null) return fail("could not read the account's contact properties")
      if (before.found) return confirm(before.found)

      const created = await createContactProperty(name, type)
      if (created.ok) return succeed()

      // Another process may have created it first, and the wording of "already
      // exists" is Loops' to change: the account's list is the authority.
      const after = await lookUp()
      if (after?.found) return confirm(after.found)
      return fail(`could not create it (${created.status ?? "no status"}: ${created.error ?? "no reason given"})`)
    } catch (err) {
      return fail(err instanceof Error ? err.message : "unexpected error")
    }
  }

  return {
    async ensure() {
      if (!isLoopsConfigured()) return false
      if (confirmed) return true
      if (failedAt !== null && Date.now() - failedAt < RETRY_AFTER_FAILURE_MS) return false
      inFlight ??= attempt().finally(() => {
        inFlight = null
      })
      return inFlight
    },
    forget() {
      confirmed = false
    },
  }
}

/** The customer's language, a string property named `language`. */
export const languageProperty = createPropertyEnsurer(LOOPS_LANGUAGE_PROPERTY, "string")
