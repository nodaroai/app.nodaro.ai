import type { FixtureEchoData } from "./types"

export const executor = {
  async execute(data: FixtureEchoData) {
    return { generatedVideoUrl: data.videoUrl }
  },
}
