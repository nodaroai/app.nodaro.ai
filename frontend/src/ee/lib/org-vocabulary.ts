import type { LocaleId } from "@nodaro/shared"
import { translate, type MessageKey, type TFunction } from "@/lib/i18n"
import { en } from "@/lib/i18n/en"
import { pluralize } from "./pluralize"

/**
 * An organization's words in the interface language.
 *
 * The server sends each organization's vocabulary resolved in English: its
 * kind's words ("Class" and "Teacher" for a school, "Team" and "Lead" for a
 * team), with any word the organization set itself in place of a default.
 * The English interface shows that unchanged. Any other language swaps a
 * word that IS one of the kinds' English defaults for the dictionary's
 * translation (`orgVocab.*`) and leaves every other word exactly as the
 * organization typed it — that word is the organization's data, not
 * interface copy.
 *
 * The English side of each `orgVocab.*` key is what a server word is matched
 * against, so it must spell the kind's default exactly. Only the concepts the
 * interface renders are listed; any other concept stays in the server's words.
 */
const DEFAULT_WORDS: Readonly<Record<string, readonly MessageKey[]>> = {
  workspace: ["orgVocab.team.workspace", "orgVocab.school.workspace"],
  org_owner: ["orgVocab.team.orgOwner", "orgVocab.school.orgOwner"],
  org_admin: ["orgVocab.team.orgAdmin", "orgVocab.school.orgAdmin"],
  workspace_admin: ["orgVocab.team.workspaceAdmin", "orgVocab.school.workspaceAdmin"],
  workspace_member: ["orgVocab.team.workspaceMember", "orgVocab.school.workspaceMember"],
}

/** The plural that belongs to each translated workspace default. */
const WORKSPACE_PLURAL: Readonly<Partial<Record<MessageKey, MessageKey>>> = {
  "orgVocab.team.workspace": "orgVocab.team.workspacePlural",
  "orgVocab.school.workspace": "orgVocab.school.workspacePlural",
}

/**
 * The vocabulary to render in `locale`. A translated workspace default also
 * brings its plural as `workspace_plural` (read it through {@link pluralWorkspaceWord}).
 */
export function localizeVocabulary(
  vocabulary: Readonly<Record<string, string>>,
  locale: LocaleId,
): Record<string, string> {
  if (locale === "en") return { ...vocabulary }
  const localized: Record<string, string> = { ...vocabulary }
  for (const [concept, keys] of Object.entries(DEFAULT_WORDS)) {
    const word = vocabulary[concept]
    const match = word === undefined ? undefined : keys.find((key) => en[key] === word)
    if (!match) continue
    localized[concept] = translate(locale, match)
    const plural = WORKSPACE_PLURAL[match]
    if (plural) localized.workspace_plural = translate(locale, plural)
  }
  return localized
}

/**
 * The plural of the workspace word: "Classes", "כיתות". A translated default
 * brings its own plural. The organization's own word takes the English rules
 * only when it is written in Latin letters; a word typed in another script is
 * shown as typed rather than given an "s". With no word at all, the
 * dictionary's generic label.
 */
export function pluralWorkspaceWord(vocabulary: Readonly<Record<string, string>>, t: TFunction): string {
  if (vocabulary.workspace_plural) return vocabulary.workspace_plural
  const word = vocabulary.workspace
  if (!word) return t("org.workspacesLabel")
  return /[A-Za-z]/.test(word) ? pluralize(word) : word
}
