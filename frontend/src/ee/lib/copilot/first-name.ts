/**
 * "Hey asi" — the greeting uses whatever first name we can honestly derive, and
 * "" when there is none (the greeting then goes without a name).
 *
 * Its own module so the middle of the canvas can greet without loading the panel.
 */
export function firstNameOf(email: string | undefined, fullName: string | undefined): string {
  const fromName = fullName?.trim().split(/\s+/)[0]
  if (fromName) return fromName
  return email?.split("@")[0] ?? ""
}
