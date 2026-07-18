import { fetchHashnodeUser, hashnodePublisher } from "../platforms/hashnode.js"
import type { SocialProvider } from "./types.js"

export const hashnodeProvider: SocialProvider = {
  id: "hashnode",
  label: "Hashnode",
  connectKind: "custom_fields",
  editor: "markdown",
  capabilities: { schedule: true, comment: false, media: ["text"], refresh: "none" },
  requiredEnv: [],
  customFields: () => [
    {
      key: "apiKey",
      label: "Personal access token",
      type: "password",
      hint: "hashnode.com → Account settings → Developer → Generate token",
      validation: "^.{10,}$",
    },
  ],
  async connectWithFields(fields) {
    const user = await fetchHashnodeUser(fields.apiKey ?? "")
    if (!user.publicationId) {
      throw new Error("This Hashnode account has no publication — create a blog on Hashnode first.")
    }
    return {
      userInfo: {
        id: user.id,
        username: user.username,
        metadata: { publication_id: user.publicationId },
      },
      accessToken: fields.apiKey ?? "",
    }
  },
  publisher: hashnodePublisher,
}
