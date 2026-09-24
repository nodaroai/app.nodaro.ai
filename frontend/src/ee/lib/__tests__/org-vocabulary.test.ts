import { describe, it, expect } from "vitest"
import { localizeVocabulary, pluralWorkspaceWord } from "../org-vocabulary"
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
  it("returns the server's words unchanged in English", () => {
    expect(localizeVocabulary(SCHOOL, "en")).toEqual(SCHOOL)
  })

  it("translates a school's default words, with the workspace plural", () => {
    expect(localizeVocabulary(SCHOOL, "he")).toEqual({
      workspace: "כיתה",
      workspace_plural: "כיתות",
      org_owner: "בעלים",
      org_admin: "מנהל",
      workspace_admin: "מורה",
      workspace_member: "תלמיד",
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
    expect(localizeVocabulary({ assignment: "Brief" }, "he")).toEqual({ assignment: "Brief" })
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
