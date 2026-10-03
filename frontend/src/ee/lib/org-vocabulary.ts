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

/** The grammatical gender of the workspace word, for languages that have one. */
export type WorkspaceGender = "f" | "m"

/**
 * The override key that declares the gender of an organization's OWN
 * workspace word (`{ "workspace": "Grupo", "workspace_gender": "m" }`). The
 * server stores it with the other overrides and leaves it out of the resolved
 * vocabulary, so it is read from the raw overrides.
 */
export const WORKSPACE_GENDER_OVERRIDE = "workspace_gender"

/** The gender each translated workspace default declares in its dictionary. */
const WORKSPACE_DEFAULT_GENDER: Readonly<Partial<Record<MessageKey, MessageKey>>> = {
  "orgVocab.team.workspace": "orgVocab.team.workspaceGender",
  "orgVocab.school.workspace": "orgVocab.school.workspaceGender",
}

// An API client may send "M" or " m": the override is free text on the server.
const genderOf = (value: string | undefined): WorkspaceGender => (value?.trim().toLowerCase() === "m" ? "m" : "f")

/**
 * The gender of the workspace word the interface will show: a translated
 * default declares its own in the dictionary; an organization's own word
 * takes its `workspace_gender` override (feminine when none is given, the
 * gender of every default); with no word at all, the generic fallback word's.
 */
function resolveWorkspaceGender(
  vocabulary: Readonly<Record<string, string>>,
  locale: LocaleId,
  overrides: Readonly<Record<string, string>> | null | undefined,
): WorkspaceGender {
  const word = vocabulary.workspace
  if (word === undefined) return genderOf(translate(locale, "org.workspaceWordGender"))
  const match = DEFAULT_WORDS.workspace.find((key) => en[key] === word)
  const declared = match ? WORKSPACE_DEFAULT_GENDER[match] : undefined
  if (declared) return genderOf(translate(locale, declared))
  return genderOf(overrides?.[WORKSPACE_GENDER_OVERRIDE])
}

/**
 * The vocabulary to render in `locale`. A translated workspace default also
 * brings its plural as `workspace_plural` (read it through {@link pluralWorkspaceWord}),
 * and every vocabulary carries `workspace_gender` (read it through
 * {@link workspaceGender}). `overrides` are the organization's raw
 * `settings.vocabulary_overrides`, where its own word's gender lives.
 */
export function localizeVocabulary(
  vocabulary: Readonly<Record<string, string>>,
  locale: LocaleId,
  overrides?: Readonly<Record<string, string>> | null,
): Record<string, string> {
  const localized: Record<string, string> = { ...vocabulary }
  if (locale !== "en") {
    for (const [concept, keys] of Object.entries(DEFAULT_WORDS)) {
      const word = vocabulary[concept]
      const match = word === undefined ? undefined : keys.find((key) => en[key] === word)
      if (!match) continue
      localized[concept] = translate(locale, match)
      const plural = WORKSPACE_PLURAL[match]
      if (plural) localized.workspace_plural = translate(locale, plural)
    }
  }
  localized.workspace_gender = resolveWorkspaceGender(vocabulary, locale, overrides)
  return localized
}

/**
 * The gender to agree with. A vocabulary from {@link localizeVocabulary}
 * carries it; an empty one means the page shows the generic fallback word.
 */
export function workspaceGender(vocabulary: Readonly<Record<string, string>>, t: TFunction): WorkspaceGender {
  return genderOf(vocabulary.workspace_gender ?? t("org.workspaceWordGender"))
}

/**
 * The sentences built around the workspace word whose wording agrees with the
 * word's gender, each with its masculine form. The base key is written for a
 * feminine word, because every default (Class, Team, the generic fallback) is
 * feminine in the gendered languages we ship; an organization's own masculine
 * word takes the variant. A language without grammatical gender gives both
 * the same text. `org-workspace-gender.test.ts` makes every sentence with the
 * word either appear here or be declared neutral.
 */
export const WORKSPACE_SENTENCE_MASCULINE: Readonly<Partial<Record<MessageKey, MessageKey>>> = {
  "org.addToWorkspace": "org.addToWorkspaceMasc",
  "org.noWorkspaceOrgOnly": "org.noWorkspaceOrgOnlyMasc",
  "org.workspaceIsArchived": "org.workspaceIsArchivedMasc",
  "org.workspaceNotFound": "org.workspaceNotFoundMasc",
  "org.workspaceMissingOrNotMember": "org.workspaceMissingOrNotMemberMasc",
  "org.archivedMembersLocked": "org.archivedMembersLockedMasc",
  "org.nobodyAddedYet": "org.nobodyAddedYetMasc",
  "org.removeFromWorkspaceOnly": "org.removeFromWorkspaceOnlyMasc",
  "org.onlyAdminCanChange": "org.onlyAdminCanChangeMasc",
  "org.archivedNothingChanges": "org.archivedNothingChangesMasc",
  "org.seeYoursInSwitcher": "org.seeYoursInSwitcherMasc",
  "org.loadThingsFailed": "org.loadThingsFailedMasc",
  "org.visibilityWorkspace": "org.visibilityWorkspaceMasc",
  "org.manageThingsOwnerAdminOnly": "org.manageThingsOwnerAdminOnlyMasc",
  "org.newWorkspace": "org.newWorkspaceMasc",
  "org.workspaceNamePlaceholder": "org.workspaceNamePlaceholderMasc",
  "org.archivedWsReadable": "org.archivedWsReadableMasc",
  "org.joinCodeDesc": "org.joinCodeDescMasc",
}

/** The key of a sentence about the workspace word, in the word's gender. */
export function genderedWorkspaceKey(key: MessageKey, gender: WorkspaceGender): MessageKey {
  return gender === "m" ? (WORKSPACE_SENTENCE_MASCULINE[key] ?? key) : key
}

/**
 * A sentence built around the workspace word. The word may open the sentence
 * (English "Class not found") or sit inside it (Portuguese "Nome da turma"),
 * so it goes in lowercase, the way every other sentence takes it, and the
 * finished sentence gets its capital. Scripts without case read the same.
 */
export function workspaceSentence(t: TFunction, key: MessageKey, workspaceWord: string, gender: WorkspaceGender): string {
  const sentence = t(genderedWorkspaceKey(key, gender), { workspace: workspaceWord.toLowerCase() })
  return sentence.charAt(0).toUpperCase() + sentence.slice(1)
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
