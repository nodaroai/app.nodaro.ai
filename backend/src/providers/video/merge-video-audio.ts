import { join } from "node:path"
import { downloadFile, runFfmpeg, createWorkDir, cleanupWorkDir } from "./ffmpeg-utils.js"

interface AudioTrack {
  readonly url: string
  readonly startTime: number
  readonly volume?: number
  readonly sourceType?: "audio" | "video"
}

interface MergeVideoAudioOptions {
  readonly videoUrl: string
  readonly audioUrl?: string
  readonly audioTracks?: readonly AudioTrack[]
  readonly voiceoverVolume?: number
  readonly backgroundVolume?: number
  readonly keepOriginalAudio?: boolean
}

/** Build FFmpeg filter_complex for mixing audio tracks (with optional original audio). */
function buildAudioFilter(
  tracks: readonly { startTime: number; volume?: number }[],
  defaultVol: number,
  bgVol: number,
  includeOriginal: boolean,
): string {
  const parts: string[] = []
  const labels: string[] = []

  for (let i = 0; i < tracks.length; i++) {
    const inputIdx = i + 1 // 0 is video
    const delayMs = Math.round(tracks[i].startTime * 1000)
    const trackVol = (tracks[i].volume ?? defaultVol) / 100
    const label = `a${i}`

    if (delayMs > 0) {
      parts.push(`[${inputIdx}:a]volume=${trackVol},adelay=delays=${delayMs}:all=1[${label}]`)
    } else {
      parts.push(`[${inputIdx}:a]volume=${trackVol}[${label}]`)
    }
    labels.push(`[${label}]`)
  }

  if (includeOriginal) {
    parts.unshift(`[0:a]volume=${bgVol}[orig]`)
    const allLabels = `[orig]${labels.join("")}`
    parts.push(`${allLabels}amix=inputs=${tracks.length + 1}:duration=longest[aout]`)
  } else if (tracks.length === 1) {
    // Single track, no amix needed - rename label to [aout]
    parts[parts.length - 1] = parts[parts.length - 1].replace(`[a0]`, `[aout]`)
  } else {
    parts.push(`${labels.join("")}amix=inputs=${tracks.length}:duration=longest[aout]`)
  }

  return parts.join(";")
}

export async function mergeVideoAudio(options: MergeVideoAudioOptions): Promise<string> {
  const { videoUrl, audioUrl, audioTracks, voiceoverVolume = 100, backgroundVolume = 100, keepOriginalAudio = false } = options
  const workDir = await createWorkDir("merge-video-audio")

  try {
    const videoPath = join(workDir, "input.mp4")
    const outputPath = join(workDir, "output.mp4")

    console.log("[mergeVideoAudio] Downloading video")
    await downloadFile(videoUrl, videoPath)

    const bgVol = backgroundVolume / 100

    // Build the list of audio tracks to merge
    const tracks: { url: string; startTime: number; volume?: number; sourceType?: "audio" | "video" }[] = []
    if (audioTracks && audioTracks.length > 0) {
      for (const t of audioTracks) {
        tracks.push({ url: t.url, startTime: t.startTime, volume: t.volume, sourceType: t.sourceType })
      }
    } else if (audioUrl) {
      tracks.push({ url: audioUrl, startTime: 0 })
    }

    if (tracks.length === 0) {
      throw new Error("No audio tracks provided")
    }

    // Download all audio tracks, extracting audio from video-type sources
    const audioPaths: string[] = []
    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i]
      console.log(`[mergeVideoAudio] Downloading audio track ${i} (start: ${track.startTime}s, vol: ${track.volume ?? voiceoverVolume}%, type: ${track.sourceType ?? "audio"})`)

      if (track.sourceType === "video") {
        // Download video then extract audio with FFmpeg
        const videoTrackPath = join(workDir, `video_track_${i}.mp4`)
        const extractedAudioPath = join(workDir, `audio_${i}.wav`)
        await downloadFile(track.url, videoTrackPath)
        console.log(`[mergeVideoAudio] Extracting audio from video track ${i}`)
        await runFfmpeg(["-y", "-i", videoTrackPath, "-vn", "-acodec", "pcm_s16le", extractedAudioPath])
        audioPaths.push(extractedAudioPath)
      } else {
        const audioPath = join(workDir, `audio_${i}.mp3`)
        await downloadFile(track.url, audioPath)
        audioPaths.push(audioPath)
      }
    }

    // Build FFmpeg command with per-track adelay filters
    const inputArgs: string[] = ["-y", "-i", videoPath]
    for (const ap of audioPaths) {
      inputArgs.push("-i", ap)
    }

    const filterComplex = buildAudioFilter(tracks, voiceoverVolume, bgVol, keepOriginalAudio)

    const doMerge = async (filter: string) => {
      await runFfmpeg([
        ...inputArgs,
        "-filter_complex", filter,
        "-map", "0:v",
        "-map", "[aout]",
        "-c:v", "copy",
        "-c:a", "aac",
        outputPath,
      ])
    }

    try {
      await doMerge(filterComplex)
    } catch {
      if (keepOriginalAudio) {
        // Fallback: video may not have audio stream, retry without original audio
        console.log("[mergeVideoAudio] Fallback: video has no audio stream, merging without original")
        const fallbackFilter = buildAudioFilter(tracks, voiceoverVolume, bgVol, false)
        await doMerge(fallbackFilter)
      } else {
        throw new Error("FFmpeg merge failed")
      }
    }

    console.log(`[mergeVideoAudio] Output: ${outputPath}`)
    return outputPath
  } catch (err) {
    await cleanupWorkDir(workDir)
    throw err
  }
}
