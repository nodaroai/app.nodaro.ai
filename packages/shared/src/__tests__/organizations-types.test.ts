import { describe, expect, it } from "vitest"
import {
  ACCESS_LEVELS,
  COLLABORATOR_ROLES,
  MEMBER_STATUSES,
  ORG_ERROR_CODES,
  ORG_KINDS,
  ORG_ROLES,
  OrgSettingsSchema,
  PRESET_SETTING_KEYS,
  PresetSettingsSchema,
  WORKSPACE_ROLES,
  WorkspaceSettingsSchema,
} from "../organizations/index.js"

describe("organizations wire contract — enums", () => {
  it("every enum is non-empty and duplicate-free", () => {
    for (const list of [ORG_KINDS, ORG_ROLES, WORKSPACE_ROLES, MEMBER_STATUSES, COLLABORATOR_ROLES, ACCESS_LEVELS, ORG_ERROR_CODES]) {
      expect(list.length).toBeGreaterThan(0)
      expect(new Set(list).size).toBe(list.length)
    }
  })

  it("error codes are snake_case identifiers", () => {
    for (const code of ORG_ERROR_CODES) expect(code).toMatch(/^[a-z][a-z_]*[a-z]$/)
  })
})

describe("organizations wire contract — settings request schemas", () => {
  it("the preset shape has exactly the eight resolvable keys", () => {
    expect([...PRESET_SETTING_KEYS].sort()).toEqual(
      [
        "admin_access",
        "collaborators_can_invite",
        "default_workflow_visibility",
        "member_access_to_shared",
        "member_caps_enabled",
        "members_can_create_projects",
        "personal_space_enabled",
        "workspace_admins_can_invite",
      ].sort(),
    )
    expect(PresetSettingsSchema.safeParse({}).success).toBe(false)
  })

  it("workspace settings are a partial of the preset; unknown keys are stripped; bad values rejected", () => {
    expect(WorkspaceSettingsSchema.parse({ admin_access: "edit", rogue: 1 })).toEqual({ admin_access: "edit" })
    expect(WorkspaceSettingsSchema.safeParse({}).success).toBe(true)
    expect(WorkspaceSettingsSchema.safeParse({ admin_access: "owner" }).success).toBe(false)
    expect(WorkspaceSettingsSchema.safeParse({ member_caps_enabled: "yes" }).success).toBe(false)
  })

  it("org settings accept lower-case domains only and string vocabulary overrides", () => {
    expect(OrgSettingsSchema.safeParse({ allowed_email_domains: ["school.edu", "sub.school.ac.il"] }).success).toBe(true)
    expect(OrgSettingsSchema.safeParse({ allowed_email_domains: ["School.edu"] }).success).toBe(false)
    expect(OrgSettingsSchema.safeParse({ allowed_email_domains: ["not a domain"] }).success).toBe(false)
    expect(OrgSettingsSchema.safeParse({ vocabulary_overrides: { workspace: "Cohort" } }).success).toBe(true)
    expect(OrgSettingsSchema.safeParse({ vocabulary_overrides: { workspace: 3 } }).success).toBe(false)
  })
})
