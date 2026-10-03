import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { en } from "@/lib/i18n/en"
import { DICTS } from "@/lib/i18n/dicts"
import { translate, type MessageKey } from "@/lib/i18n"
import { WORKSPACE_SENTENCE_MASCULINE, genderedWorkspaceKey } from "../org-vocabulary"

/**
 * The organization's workspace word ("Class", "Team", or a word the
 * organization chose) lands in sentences that, in Hebrew and Portuguese,
 * agree with its gender. Each such sentence has a masculine variant chosen by
 * the word's gender; a sentence that reads the same either way is declared
 * neutral here. A new sentence with the word must take one side, or a
 * masculine word renders with feminine agreement ("צוות זו", "Esta grupo").
 */

/** Sentences with the word that read the same for either gender, each with why. */
const NEUTRAL: Readonly<Record<string, string>> = {
  "org.noPluralYet": "‘עדיין אין {plural}’ / ‘Ainda não há {plural}’ — no article, no agreement",
  "org.workspaceAtOrg": "‘{workspace} ב־{org}’ / ‘{workspace} ({org})’ — a name line",
  "org.aWorkspaceSuffix": "‘ — סוג: {workspace}’ / ‘ — tipo: {workspace}’ — a label, no article",
  "org.pendingReviewBody": "‘ליצור {things}’ / ‘criar {things}’ — a bare plural object",
  "org.pendingReviewBodyAlt": "same wording as pendingReviewBody",
  "org.memberAccessSharedQ": "‘ל־{workspace}’ / ‘em cada {workspace}’ — cada does not inflect",
}

/**
 * Placeholders of organization sentences that never carry the workspace word.
 * The word enters a sentence only as {workspace}, {things} or {plural}, which
 * is what the checks below look for; a placeholder with a new name is
 * classified here first. (The join-code card once took the word as {word}, and
 * its sentence kept feminine agreement for every organization.)
 */
const OTHER_PLACEHOLDERS: ReadonlySet<string> = new Set([
  "n", "max", "sent", "handover", "list", "code", "date", "email", "name", "org", "role", "status",
])

const text = (k: string) => (en as Record<string, string>)[k]
// {workspace} and {things} are the workspace word in any namespace. {plural}
// is also the entity kinds' word (entity.*), so it counts inside org.* only.
const mentionsWord = (k: string) =>
  !k.endsWith("Masc") && (/\{(workspace|things)\}/.test(text(k)) || (k.startsWith("org.") && text(k).includes("{plural}")))
const placeholders = (s: string) => (s.match(/\{[^{}]*\}/g) ?? []).slice().sort().join("|")
const names = (s: string) => (s.match(/\{(\w+)\}/g) ?? []).map((p) => p.slice(1, -1))

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === "__tests__" || name === "i18n" ? [] : sourceFiles(path)
    return /\.(ts|tsx)$/.test(name) ? [path] : []
  })
}

describe("sentences built around the workspace word", () => {
  it("each has a masculine variant or is declared neutral", () => {
    const words = Object.keys(en).filter(mentionsWord)
    const unclassified = words.filter((k) => !(k in WORKSPACE_SENTENCE_MASCULINE) && !(k in NEUTRAL))
    expect(unclassified, "add a …Masc variant to WORKSPACE_SENTENCE_MASCULINE, or declare the sentence NEUTRAL").toEqual([])
    const stale = [...Object.keys(WORKSPACE_SENTENCE_MASCULINE), ...Object.keys(NEUTRAL)].filter((k) => !words.includes(k))
    expect(stale, "listed but no longer a sentence with the word").toEqual([])
  })

  it("takes the word only as {workspace}, {things} or {plural}", () => {
    const used = new Set(Object.keys(en).filter((k) => k.startsWith("org.")).flatMap((k) => names(text(k))))
    const unknown = [...used].filter((n) => !["workspace", "things", "plural"].includes(n) && !OTHER_PLACEHOLDERS.has(n))
    expect(unknown, "a placeholder that carries the workspace word is named {workspace}; any other goes in OTHER_PLACEHOLDERS").toEqual([])
    expect([...OTHER_PLACEHOLDERS].filter((n) => !used.has(n)), "no longer used — drop it").toEqual([])
  })

  it("keeps the placeholders of each base sentence in its masculine variant, in every locale", () => {
    const bad: string[] = []
    for (const [base, masc] of Object.entries(WORKSPACE_SENTENCE_MASCULINE) as Array<[MessageKey, MessageKey]>) {
      for (const [locale, dict] of Object.entries(DICTS)) {
        const d = dict as Record<string, string>
        if (d[base] === undefined) continue
        if (placeholders(d[base]) !== placeholders(d[masc] ?? "")) bad.push(`${locale} ${masc}`)
      }
    }
    expect(bad).toEqual([])
  })

  it("declares the gender of every default word as f, m or nothing", () => {
    const keys: MessageKey[] = ["orgVocab.team.workspaceGender", "orgVocab.school.workspaceGender", "org.workspaceWordGender"]
    const bad = Object.entries(DICTS).flatMap(([locale, dict]) =>
      keys.filter((k) => !["", "f", "m"].includes((dict as Record<string, string>)[k] ?? "")).map((k) => `${locale} ${k}`),
    )
    expect(bad).toEqual([])
  })

  it("renders a masculine word with masculine agreement", () => {
    expect(translate("he", genderedWorkspaceKey("org.workspaceIsArchived", "m"), { workspace: "צוות" })).toBe("צוות זה בארכיון.")
    expect(translate("he", genderedWorkspaceKey("org.newWorkspace", "m"), { workspace: "צוות" })).toBe("צוות חדש")
    expect(translate("pt-BR", genderedWorkspaceKey("org.workspaceIsArchived", "m"), { workspace: "grupo" })).toBe("Este grupo está arquivado.")
    expect(translate("pt-BR", genderedWorkspaceKey("org.newWorkspace", "m"), { workspace: "grupo" })).toBe("Novo grupo")
    expect(translate("he", genderedWorkspaceKey("org.joinCodeDesc", "m"), { workspace: "צוות" })).toContain("ל־צוות זה כחבר")
    expect(translate("pt-BR", genderedWorkspaceKey("org.joinCodeDesc", "m"), { workspace: "grupo" })).toContain("neste grupo")
    // The feminine base is untouched.
    expect(translate("he", genderedWorkspaceKey("org.workspaceIsArchived", "f"), { workspace: "כיתה" })).toBe("כיתה זו בארכיון.")
  })

  it("is only ever rendered through the gender — no call site uses a gendered key directly", () => {
    const root = join(__dirname, "..", "..", "..")
    const direct: string[] = []
    for (const file of sourceFiles(root)) {
      if (file.endsWith("org-vocabulary.ts")) continue
      const lines = readFileSync(file, "utf-8").split("\n")
      lines.forEach((line, i) => {
        for (const key of Object.keys(WORKSPACE_SENTENCE_MASCULINE)) {
          if (line.includes(`"${key}"`) && !/genderedWorkspaceKey\(|workspaceSentence\(/.test(line)) {
            direct.push(`${relative(root, file)}:${i + 1} ${key}`)
          }
        }
      })
    }
    expect(direct).toEqual([])
  })

  it("localizes the vocabulary with the organization's overrides, where its own word's gender lives", () => {
    const root = join(__dirname, "..", "..", "..")
    // The hook forwards its own argument; the public invitation preview has no
    // overrides to pass, and its one sentence with the word is neutral.
    const exempt = ["ee/lib/org-vocabulary.ts", "ee/hooks/use-org-vocabulary.ts", "ee/app/join/invitation-page.tsx"]
    const without: string[] = []
    for (const file of sourceFiles(root)) {
      const path = relative(root, file)
      if (exempt.includes(path)) continue
      readFileSync(file, "utf-8").split("\n").forEach((line, i) => {
        if (/\b(useOrgVocabulary|localizeVocabulary)\(/.test(line) && !line.includes("vocabulary_overrides")) without.push(`${path}:${i + 1}`)
      })
    }
    expect(without, "pass the organization's settings.vocabulary_overrides").toEqual([])
  })
})
