import { describe, expect, it } from "vitest"
import { dubbingModelIdOfRequest, dubbingModelIdentifier, dubsAsProject } from "../dubbing-model.js"

describe("the row a dub is charged on", () => {
  it("follows the target language for a request", () => {
    expect(dubbingModelIdentifier("fr")).toBe("elevenlabs-dubbing")
    expect(dubbingModelIdentifier("he")).toBe("elevenlabs-dubbing-v2")
    expect(dubbingModelIdentifier("HEB")).toBe("elevenlabs-dubbing-v2")
    expect(dubbingModelIdentifier(undefined)).toBe("elevenlabs-dubbing")
    expect(dubsAsProject("he")).toBe(true)
    expect(dubsAsProject("es")).toBe(false)
  })
})

describe("the row a stored dub is charged on", () => {
  it("is the one the server stamped, whatever language it speaks", () => {
    expect(dubbingModelIdOfRequest({ targetLanguage: "es", dubbingModelId: "elevenlabs-dubbing-v2" })).toBe("elevenlabs-dubbing-v2")
    expect(dubbingModelIdOfRequest({ targetLanguage: "he", dubbingModelId: "elevenlabs-dubbing" })).toBe("elevenlabs-dubbing")
  })

  it("follows the language when the job carries no stamp", () => {
    expect(dubbingModelIdOfRequest({ targetLanguage: "es" })).toBe("elevenlabs-dubbing")
    expect(dubbingModelIdOfRequest({ targetLanguage: "he" })).toBe("elevenlabs-dubbing-v2")
  })

  it("ignores a stamp that is not a dubbing row", () => {
    for (const dubbingModelId of ["gpt-image", "", 7, null, {}, ["elevenlabs-dubbing-v2"]]) {
      expect(dubbingModelIdOfRequest({ targetLanguage: "es", dubbingModelId })).toBe("elevenlabs-dubbing")
      expect(dubbingModelIdOfRequest({ targetLanguage: "he", dubbingModelId })).toBe("elevenlabs-dubbing-v2")
    }
  })

  it("never throws on something that is not a request", () => {
    for (const request of [undefined, null, "es", 3, []]) {
      expect(dubbingModelIdOfRequest(request)).toBe("elevenlabs-dubbing")
    }
  })
})
