import { devtoPublisher, fetchDevtoUser } from "../platforms/devto.js"
import type { SocialProvider } from "./types.js"

export const devtoProvider: SocialProvider = {
  id: "devto",
  label: "Dev.to",
  connectKind: "custom_fields",
  editor: "markdown",
  capabilities: { schedule: true, comment: false, media: ["text"], refresh: "none" },
  requiredEnv: [],
  customFields: () => [
    {
      key: "apiKey",
      label: "API key",
      type: "password",
      hint: "dev.to → Settings → Extensions → Generate API key",
      validation: "^.{10,}$",
    },
  ],
  async connectWithFields(fields) {
    const user = await fetchDevtoUser(fields.apiKey ?? "")
    return {
      userInfo: { id: user.id, username: user.username },
      accessToken: fields.apiKey ?? "",
    }
  },
  publisher: devtoPublisher,
}
