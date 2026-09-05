// Generic in-repo overlay fixture. NOT customer content — proves the loader
// runs a real register() that exercises all five registry setters. Paths are
// relative from backend/src/lib/overlay/__tests__/fixtures/.
import { setEgressDecorator } from "../../../../providers/egress.js"
import { setBillingProvider } from "../../../billing-provider.js"
import { registerPromptPolicy } from "../../../prompt-policy.js"
import { registerCatalogPack, registerPersonPack } from "@nodaro/prompts"
import { OVERLAY_CONTRACT_VERSION } from "../../load.js"

export const overlayContractVersion = OVERLAY_CONTRACT_VERSION

export function register(): void {
  setEgressDecorator({
    decorate: () => ({ headers: { "X-Test-Overlay": "1" } }),
  })
  setBillingProvider({
    id: "test-overlay-billing",
    displayUnit: "credits",
    async report() {
      return null
    },
    async account() {
      return null
    },
  })
  registerPromptPolicy({
    id: "test-overlay-policy",
    apply: (a) => ({ ...a, prompt: `${a.prompt} [overlay]` }),
  })
  registerCatalogPack({
    id: "test-overlay-catalog",
    catalogId: "setting",
    mode: "deny",
    denyIds: ["nonexistent-id"],
  })
  registerPersonPack({
    id: "test-overlay-person",
    dimensions: [{ dimension: "test_dim", field: "testField", label: "Test Dim" }],
    entries: [
      {
        id: "test-person-1",
        dimension: "test_dim",
        label: "Test Person 1",
        description: "A generic fixture person — not customer content",
        promptHint: "test person one",
      },
    ],
  })
}
