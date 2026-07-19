import { fetchMediumUser, mediumPublisher } from "../platforms/medium.js"
import type { SocialProvider } from "./types.js"

export const mediumProvider: SocialProvider = {
  id: "medium",
  label: "Medium",
  connectKind: "custom_fields",
  editor: "markdown",
  capabilities: { schedule: true, comment: false, media: ["text"], refresh: "none" },
  requiredEnv: [],
  customFields: () => [
    {
      key: "apiKey",
      label: "Integration token",
      type: "password",
      hint: "Medium no longer issues new tokens in-app. If Settings → Security has no 'Integration tokens' section, request one from Medium support (yourfriends@medium.com). Existing tokens work.",
      validation: "^.{10,}$",
    },
  ],
  async connectWithFields(fields) {
    const user = await fetchMediumUser(fields.apiKey ?? "")
    return {
      userInfo: {
        id: user.id,
        username: `@${user.username}`,
        metadata: { author_id: user.id },
      },
      accessToken: fields.apiKey ?? "",
    }
  },
  publisher: mediumPublisher,
}
