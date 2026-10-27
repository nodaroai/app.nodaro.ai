/**
 * `@nodaro/sdk/user-settings` — the `userSettings` resource and its types.
 *
 * One of the package's subpath entries (see `src/index.ts`). The root
 * re-exports every entry, so each name here is also importable from
 * `@nodaro/sdk`.
 */
export { UserSettingsResource } from "../resources/user-settings.js"

export type {
  UserSettings,
  UserSettingsPatch,
  UserSettingsSaved,
  UserSettingsLocale,
  UserTextTemplate,
  UserMcpPreferences,
  VariableDisplayMode,
  NodeDoubleClickAction,
} from "../resources/user-settings.js"
