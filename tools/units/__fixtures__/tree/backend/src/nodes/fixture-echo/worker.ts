export async function worker(input: { videoUrl?: string }) {
  return { videoUrl: input.videoUrl }
}
