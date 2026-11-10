/**
 * The reason a greyed Speaker View / Speaker Layout choice shows. `nothing-cut`
 * is Speaker Layout's Crossfade (the layout cuts nothing out of the recording,
 * so there is no jump to crossfade over): one sentence, in every dictionary.
 */
import { describe, it, expect } from "vitest"
import { speakerLayoutCrossfade } from "@nodaro/render-rules"
import { DICTS } from "@/lib/i18n/dicts"
import { translate } from "@/lib/i18n"
import { speakerViewReasonText } from "../speaker-view-reasons"

describe("speakerViewReasonText: nothing-cut", () => {
  it("says why Speaker Layout's crossfade is greyed", () => {
    const reason = speakerLayoutCrossfade().reason!
    expect(reason.code).toBe("nothing-cut")
    expect(speakerViewReasonText(reason, (key, vars) => translate("en", key, vars))).toBe(
      "Nothing is cut out of the recording, so there is nothing to crossfade.",
    )
  })

  it("is in all twelve dictionaries, translated where the dictionary is not English", () => {
    expect(Object.keys(DICTS)).toHaveLength(12)
    for (const [locale, dict] of Object.entries(DICTS)) {
      const text = dict?.["speakerView.reason.nothingCut"]
      expect(text?.trim(), locale).toBeTruthy()
      if (locale !== "en") expect(text, locale).not.toBe(DICTS.en!["speakerView.reason.nothingCut"])
    }
  })
})
