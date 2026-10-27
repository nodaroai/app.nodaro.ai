import type { NodaroClientCore } from "../core.js"

/**
 * The signed-in person's own settings — the shape of `GET` / `PATCH
 * /v1/user/settings` (`backend/src/routes/user-settings.ts`, the source of
 * truth: keep these in sync if they change). A first-party app renders the
 * ones it cares about (the monthly statement opt-in on a billing screen, the
 * interface language) and sends back only the fields it changes.
 */

/** How `{nodeRef}` placeholders render in prompt fields. */
export type VariableDisplayMode = "raw" | "annotated" | "resolved"
/** What double-clicking a canvas node does. */
export type NodeDoubleClickAction = "zoom" | "settings"
/** The interface languages Nodaro ships; the server refuses any other value. */
export type UserSettingsLocale = "en" | "es" | "fr" | "de" | "pt-BR" | "ru" | "hi" | "ja" | "ko" | "zh-CN" | "he" | "ar"

/** One of the person's own Generate Text templates. */
export interface UserTextTemplate {
  id: string
  /** Up to 80 characters. */
  label: string
  /** Up to 10,000 characters. */
  systemPrompt: string
  defaultInput?: string
  /** 1–16,384. */
  defaultMaxTokens?: number
  llmModel?: string
  reasoningEffort?: string
  fansOut?: boolean
  requiresImageRef?: boolean
}

/** Per-user MCP defaults, sparse: a key left out keeps its stored value. */
export interface UserMcpPreferences {
  image?: { model?: string; aspectRatio?: string; resolution?: string; quality?: string }
  video?: { model?: string; aspectRatio?: string; duration?: number; resolution?: string }
  audio?: { ttsModel?: string; musicModel?: string }
  flows?: { enabled?: boolean }
}

export interface UserSettings {
  /** The stored billing tier (`"free"`, `"basic"`, …). */
  tier: string | null
  /** Whether generations are visible in the public gallery. */
  publicOutputs: boolean
  /** Per-template overrides of the system prompts, by template key. */
  promptTemplates: Record<string, string>
  /** The person's own Generate Text templates. */
  textTemplates: UserTextTemplate[]
  /** The interface language; `null` = the browser's. */
  preferredLocale: UserSettingsLocale | null
  mcpPreferences: UserMcpPreferences
  showRecentNodes: boolean
  showMostUsedNodes: boolean
  variableDisplayMode: VariableDisplayMode
  nodeDoubleClickAction: NodeDoubleClickAction
  /** A statement of last month's credit usage by email on the 1st. Default `false`. */
  monthlyStatementEmail: boolean
}

/**
 * What `update()` sends: only the fields to change. `promptTemplates` and
 * `textTemplates` REPLACE the stored value whole (send the full map or list;
 * a template key the server does not know, or a value equal to the default,
 * is dropped); `mcpPreferences` merges one axis at a time.
 */
export interface UserSettingsPatch {
  /** `false` needs the Standard plan or above on Nodaro Cloud (`ForbiddenError` otherwise). */
  publicOutputs?: boolean
  promptTemplates?: Record<string, string>
  /** Up to 100. */
  textTemplates?: UserTextTemplate[]
  preferredLocale?: UserSettingsLocale | null
  mcpPreferences?: UserMcpPreferences
  showRecentNodes?: boolean
  showMostUsedNodes?: boolean
  variableDisplayMode?: VariableDisplayMode
  nodeDoubleClickAction?: NodeDoubleClickAction
  monthlyStatementEmail?: boolean
}

/** What `update()` answers: the settings as saved (without `tier`). */
export type UserSettingsSaved = Omit<UserSettings, "tier">

export class UserSettingsResource {
  constructor(private client: NodaroClientCore) {}

  /**
   * `GET /v1/user/settings` → the person's own settings. Throws
   * `UnauthorizedError` (401) when signed out, `NotFoundError` with no
   * profile row.
   */
  async get(): Promise<UserSettings> {
    const res = await this.client.request<{ data: UserSettings }>("GET", "/v1/user/settings")
    return res.data
  }

  /**
   * `PATCH /v1/user/settings` → changes the fields sent and answers the
   * settings as saved. A `NodaroError` with status 400 names an invalid
   * value (`validation_error`), or says so for a patch with nothing to
   * change; `ForbiddenError` for `publicOutputs: false` below the Standard
   * plan; `NotFoundError` with no profile row.
   */
  async update(patch: UserSettingsPatch): Promise<UserSettingsSaved> {
    const res = await this.client.request<{ data: UserSettingsSaved }>("PATCH", "/v1/user/settings", { body: patch })
    return res.data
  }
}
