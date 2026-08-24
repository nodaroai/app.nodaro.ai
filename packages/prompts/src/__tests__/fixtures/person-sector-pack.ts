import type { PersonPack } from "../../person-packs.js"
// A neutral, non-SAI fixture exercising the B7 shape: a new person dimension
// with entries, a Hebrew sidecar, and the other 10 locales declared exempt.
export const PERSON_SECTOR_PACK: PersonPack = {
  id: "fixture/person-sector",
  dimensions: [{ dimension: "sector-attire", field: "sectorAttire", label: "Sector Attire" }],
  entries: [
    {
      id: "attire-modest-suit",
      label: "Modest Suit",
      group: "Attire",
      dimension: "sector-attire",
      description: "a modest tailored suit",
      promptHint: "wearing a modest tailored suit",
    },
    {
      id: "attire-long-coat",
      label: "Long Coat",
      group: "Attire",
      dimension: "sector-attire",
      description: "a long formal coat",
      promptHint: "wearing a long formal coat",
    },
  ],
  sidecars: { he: { "attire-modest-suit": { label: "חליפה צנועה" }, "attire-long-coat": { label: "מעיל ארוך" } } },
  exemptSidecarLocales: ["es", "fr", "de", "pt-BR", "ru", "hi", "ja", "ko", "zh-CN", "ar"],
}
