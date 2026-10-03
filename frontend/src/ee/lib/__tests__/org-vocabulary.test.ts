import { describe, it, expect } from "vitest"
import { genderedWorkspaceKey, localizeVocabulary, pluralWorkspaceWord, workspaceGender, workspaceSentence } from "../org-vocabulary"
import { FALLBACK_VOCABULARY } from "@/ee/hooks/use-workspace"
import { translate, type TFunction } from "@/lib/i18n"
import { en } from "@/lib/i18n/en"

const heT: TFunction = (key, vars) => translate("he", key, vars)
const enT: TFunction = (key, vars) => translate("en", key, vars)

const SCHOOL = {
  workspace: "Class",
  org_owner: "Owner",
  org_admin: "Administrator",
  workspace_admin: "Teacher",
  workspace_member: "Student",
}

describe("localizeVocabulary", () => {
  it("returns the server's words unchanged in English, with the workspace word's gender", () => {
    expect(localizeVocabulary(SCHOOL, "en")).toEqual({ ...SCHOOL, workspace_gender: "f" })
  })

  it("translates a school's default words, with the workspace plural", () => {
    expect(localizeVocabulary(SCHOOL, "he")).toEqual({
      workspace: "כיתה",
      workspace_plural: "כיתות",
      org_owner: "בעלים",
      org_admin: "מנהל",
      workspace_admin: "מורה",
      workspace_member: "תלמיד",
      workspace_gender: "f",
    })
  })

  it("translates the team vocabulary the interface falls back to", () => {
    const team = localizeVocabulary(FALLBACK_VOCABULARY, "he")
    expect(team.workspace).toBe("קבוצה")
    expect(team.workspace_plural).toBe("קבוצות")
    expect(team.workspace_admin).toBe("ראש קבוצה")
    expect(team.workspace_member).toBe("חבר")
  })

  it("keeps a word the organization set itself exactly as typed", () => {
    const own = localizeVocabulary({ workspace: "Cohort", workspace_member: "Student" }, "he")
    expect(own.workspace).toBe("Cohort")
    expect(own.workspace_plural).toBeUndefined()
    expect(own.workspace_member).toBe("תלמיד")
  })

  it("leaves a concept the interface does not render in the server's words", () => {
    // With no workspace word, the gender is the generic fallback word's.
    expect(localizeVocabulary({ assignment: "Brief" }, "he")).toEqual({ assignment: "Brief", workspace_gender: "f" })
  })
})

describe("pluralWorkspaceWord", () => {
  it("uses the plural a translated default brings", () => {
    expect(pluralWorkspaceWord(localizeVocabulary(SCHOOL, "he"), heT)).toBe("כיתות")
  })

  it("pluralizes a word in Latin letters by the English rules", () => {
    expect(pluralWorkspaceWord({ workspace: "Class" }, enT)).toBe("Classes")
    expect(pluralWorkspaceWord(localizeVocabulary({ workspace: "Cohort" }, "he"), heT)).toBe("Cohorts")
  })

  it("shows a word typed in another script as typed", () => {
    expect(pluralWorkspaceWord({ workspace: "חוג" }, heT)).toBe("חוג")
  })

  it("falls back to the dictionary's generic label", () => {
    expect(pluralWorkspaceWord({}, heT)).toBe(translate("he", "org.workspacesLabel"))
  })
})

describe("orgVocab dictionary", () => {
  it("spells the team defaults exactly as the fallback vocabulary, which is what the match compares", () => {
    expect({
      workspace: en["orgVocab.team.workspace"],
      org_owner: en["orgVocab.team.orgOwner"],
      org_admin: en["orgVocab.team.orgAdmin"],
      workspace_admin: en["orgVocab.team.workspaceAdmin"],
      workspace_member: en["orgVocab.team.workspaceMember"],
    }).toEqual({
      workspace: FALLBACK_VOCABULARY.workspace,
      org_owner: FALLBACK_VOCABULARY.org_owner,
      org_admin: FALLBACK_VOCABULARY.org_admin,
      workspace_admin: FALLBACK_VOCABULARY.workspace_admin,
      workspace_member: FALLBACK_VOCABULARY.workspace_member,
    })
  })
})

describe("workspaceSentence", () => {
  // A stand-in dictionary: English opens the sentence with the word, Portuguese
  // puts it mid-sentence. Both must read in sentence case.
  const english: TFunction = (_key, vars) => `${vars?.workspace} not found`
  const portuguese: TFunction = (_key, vars) => `Nome da ${vars?.workspace}`

  it("capitalizes the word when it opens the sentence", () => {
    expect(workspaceSentence(english, "org.workspaceNotFound", "Class", "f")).toBe("Class not found")
  })

  it("keeps the word lowercase inside the sentence", () => {
    expect(workspaceSentence(portuguese, "org.workspaceNamePlaceholder", "Turma", "f")).toBe("Nome da turma")
  })

  it("leaves a script without case as it is", () => {
    const hebrew: TFunction = (_key, vars) => `${vars?.workspace} לא נמצאה`
    expect(workspaceSentence(hebrew, "org.workspaceNotFound", "כיתה", "f")).toBe("כיתה לא נמצאה")
  })
})

describe("the workspace word's gender", () => {
  const heT: TFunction = (key, vars) => translate("he", key, vars)
  const ptT: TFunction = (key, vars) => translate("pt-BR", key, vars)

  it("takes a translated default's gender from the dictionary", () => {
    expect(localizeVocabulary({ workspace: "Class" }, "he").workspace_gender).toBe("f")
    expect(localizeVocabulary({ workspace: "Team" }, "pt-BR").workspace_gender).toBe("f")
  })

  it("takes the organization's own word's gender from its overrides", () => {
    const vocabulary = localizeVocabulary({ workspace: "צוות" }, "he", { workspace: "צוות", workspace_gender: "m" })
    expect(workspaceGender(vocabulary, heT)).toBe("m")
    expect(heT(genderedWorkspaceKey("org.workspaceIsArchived", workspaceGender(vocabulary, heT)), { workspace: "צוות" })).toBe("צוות זה בארכיון.")
  })

  it("accepts the override in any case and with stray spaces", () => {
    expect(localizeVocabulary({ workspace: "Grupo" }, "pt-BR", { workspace: "Grupo", workspace_gender: " M " }).workspace_gender).toBe("m")
  })

  it("reads an own word with no declared gender as feminine, like every default", () => {
    expect(localizeVocabulary({ workspace: "Grupo" }, "pt-BR", { workspace: "Grupo" }).workspace_gender).toBe("f")
  })

  it("uses the fallback word's gender when there is no vocabulary", () => {
    expect(workspaceGender({}, heT)).toBe("f")
    expect(workspaceGender({}, ptT)).toBe("f")
  })

  it("renders the Portuguese masculine sentences", () => {
    expect(ptT(genderedWorkspaceKey("org.workspaceIsArchived", "m"), { workspace: "grupo" })).toBe("Este grupo está arquivado.")
    expect(workspaceSentence(ptT, "org.workspaceNamePlaceholder", "Grupo", "m")).toBe("Nome do grupo")
    expect(workspaceSentence(ptT, "org.workspaceNamePlaceholder", "Turma", "f")).toBe("Nome da turma")
  })
})
