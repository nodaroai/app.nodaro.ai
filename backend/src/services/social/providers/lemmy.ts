import { lemmyLogin, lemmyPublisher, resolveLemmyCommunity } from "../platforms/lemmy.js"
import type { SocialProvider } from "./types.js"

export const lemmyProvider: SocialProvider = {
  id: "lemmy",
  label: "Lemmy",
  connectKind: "custom_fields",
  editor: "markdown",
  capabilities: { schedule: true, comment: false, media: ["image", "text"], refresh: "none" },
  requiredEnv: [],
  customFields: () => [
    {
      key: "service",
      label: "Instance",
      type: "text",
      defaultValue: "https://lemmy.world",
      validation: "^https?://.+",
    },
    { key: "identifier", label: "Username or email", type: "text", validation: "^.{3,}$" },
    { key: "password", label: "Password", type: "password", validation: "^.{3,}$" },
    {
      key: "community",
      label: "Community",
      type: "text",
      hint: "The community to post into, e.g. \"technology\"",
      validation: "^.{2,}$",
    },
  ],
  async connectWithFields(fields) {
    const service = (fields.service ?? "https://lemmy.world").replace(/\/+$/, "")
    const jwt = await lemmyLogin(service, fields.identifier ?? "", fields.password ?? "")
    // Validate the community up front — a typo here would otherwise surface
    // only at publish time (possibly scheduled, days later).
    await resolveLemmyCommunity(service, jwt, fields.community ?? "")
    return {
      userInfo: {
        id: `${new URL(service).hostname}:${fields.identifier}`,
        username: fields.identifier,
        metadata: { service, identifier: fields.identifier, community: fields.community },
      },
      accessToken: fields.password ?? "",
    }
  },
  publisher: lemmyPublisher,
}
