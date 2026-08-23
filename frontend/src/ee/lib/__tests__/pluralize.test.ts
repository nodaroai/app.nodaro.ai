import { describe, expect, it } from "vitest"
import { pluralize } from "../pluralize"

/**
 * The words here are the ones the product actually uses — the workspace
 * labels a school and a company each get by default, plus the shapes an
 * administrator is likely to type when relabelling.
 */
describe("pluralize", () => {
  it("gets the two default vocabularies right", () => {
    // "Class" + "s" was "Classs" in the switcher, which is why this exists.
    expect(pluralize("Class")).toBe("Classes")
    expect(pluralize("Team")).toBe("Teams")
  })

  it("adds -es after a sibilant, where a bare -s is unpronounceable", () => {
    expect(pluralize("Box")).toBe("Boxes")
    expect(pluralize("Batch")).toBe("Batches")
    expect(pluralize("Bush")).toBe("Bushes")
  })

  it("turns -y into -ies only after a consonant", () => {
    expect(pluralize("Company")).toBe("Companies")
    expect(pluralize("Faculty")).toBe("Faculties")
    expect(pluralize("Day")).toBe("Days")
    expect(pluralize("Journey")).toBe("Journeys")
  })

  it("keeps the caller's casing — the label is theirs, not ours", () => {
    expect(pluralize("cohort")).toBe("cohorts")
    expect(pluralize("CLASS")).toBe("CLASSes")
  })

  it("does not pretend to handle irregulars — a wrong guess at someone's own word is worse", () => {
    // "Quizzes" doubles the z; the regular rules give "Quizes". Rather than
    // grow a dictionary against user-supplied labels, the rule stays regular
    // and an organization that needs an exact plural sets the label itself.
    expect(pluralize("Quiz")).toBe("Quizes")
    expect(pluralize("Person")).toBe("Persons")
  })

  it("is total: an empty or one-letter label does not throw", () => {
    expect(pluralize("")).toBe("")
    expect(pluralize("y")).toBe("ys")
    expect(pluralize("s")).toBe("ses")
  })
})
