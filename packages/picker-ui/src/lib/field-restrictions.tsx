"use client"
import { createContext, useCallback, useContext, type ReactNode } from "react"

const Ctx = createContext<Readonly<Record<string, readonly string[]>> | undefined>(undefined)

/** Restrict what each field of a multi-dimension picker offers (an app card's per-field allowed values). */
export function PickerFieldRestrictionsProvider({ allowedByField, children }: {
  readonly allowedByField: Readonly<Record<string, readonly string[]>> | undefined
  readonly children: ReactNode
}) {
  return <Ctx.Provider value={allowedByField}>{children}</Ctx.Provider>
}

/** The entries of `field` this card allows; all of them when the restriction would leave none. */
export function usePickerFieldRestriction(field: string) {
  const allowed = useContext(Ctx)?.[field]
  return useCallback(<T extends { readonly id: string }>(entries: readonly T[]): readonly T[] => {
    if (!allowed || allowed.length === 0) return entries
    const set = new Set(allowed)
    const subset = entries.filter((e) => set.has(e.id))
    return subset.length > 0 ? subset : entries
  }, [allowed])
}
