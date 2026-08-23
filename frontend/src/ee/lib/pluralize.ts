/**
 * Pluralizing a vocabulary label.
 *
 * The organization's own words are configurable, so the UI cannot hard-code
 * either the singular or the plural: a school calls a workspace a "Class"
 * and a company calls it a "Team", and an administrator may relabel either.
 * Appending "s" gets "Teams" right and "Classs" wrong, which is precisely
 * the kind of thing that makes an interface look unfinished to the people
 * whose word it mangled.
 *
 * Deliberately small: the regular English rules and nothing else. An
 * irregular label ("Person" → "People") is not guessed at — the vocabulary
 * is user-supplied text and a wrong guess reads worse than a plain one, so
 * anywhere a plural must be exact should let the organization set it rather
 * than have this file grow a dictionary.
 */
export function pluralize(word: string): string {
  if (word.length === 0) return word

  const lower = word.toLowerCase()

  // -y after a consonant becomes -ies ("Company" → "Companies"), but not
  // after a vowel ("Day" → "Days").
  if (lower.endsWith("y") && word.length > 1 && !"aeiou".includes(lower[lower.length - 2])) {
    return `${word.slice(0, -1)}ies`
  }

  // Sibilant endings take -es, or the plural is unpronounceable ("Classes",
  // "Boxes", "Batches"). This is the case that made this function exist.
  if (/(s|x|z|ch|sh)$/.test(lower)) return `${word}es`

  return `${word}s`
}
