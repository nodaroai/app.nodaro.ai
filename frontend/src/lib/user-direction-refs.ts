/**
 * A node's stored `direction` can name one of the person's own palettes or
 * moodboards (`colorLook: "palette:<id>"`, `style: "moodboard:<id>"`). The
 * server resolves those when a run starts (the workflow run, the API); the
 * editor cannot read them, so the single-node Run refuses such a node and the
 * Final view says the clause is added at run time. Shape only — nothing here
 * reads the palette or the moodboard.
 */
import { parseUserDirectionRef, type UserDirectionRefKind } from "@nodaro/prompts/prompt-builder"

export interface UserDirectionRefValue {
  readonly value: string
  readonly kind: UserDirectionRefKind
}

/** Every palette / moodboard value a direction bag holds, on any key, alone or in a list. */
export function userDirectionRefs(direction: unknown): UserDirectionRefValue[] {
  if (typeof direction !== "object" || direction === null || Array.isArray(direction)) return []
  const found: UserDirectionRefValue[] = []
  for (const raw of Object.values(direction)) {
    const values: unknown[] = typeof raw === "string" ? [raw] : Array.isArray(raw) ? raw : []
    for (const value of values) {
      const ref = parseUserDirectionRef(value)
      if (ref) found.push({ value: value as string, kind: ref.kind })
    }
  }
  return found
}

/** Does this direction bag name one of the person's palettes or moodboards? */
export function namesUserDirectionRef(direction: unknown): boolean {
  return userDirectionRefs(direction).length > 0
}
