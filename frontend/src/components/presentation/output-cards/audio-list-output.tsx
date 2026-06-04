import { IterationProgress, type GalleryOutputProps } from "./shared"
import { WaveformAudioPlayer } from "@/components/audio-player"

export function AudioListOutput({
  results,
  status,
  iterationTotal,
  iterationCompleted,
}: GalleryOutputProps) {
  const filtered = results.filter(Boolean)

  return (
    <div>
      <IterationProgress status={status} iterationTotal={iterationTotal} iterationCompleted={iterationCompleted} />
      <div className="flex flex-col gap-1.5">
        {filtered.map((url, i) => (
          <div
            key={i}
            className="flex items-center gap-2.5 bg-background border border-border rounded-md px-2.5 py-2"
          >
            <span className="text-xs text-muted-foreground font-medium min-w-[24px]">
              #{i + 1}
            </span>
            <WaveformAudioPlayer url={url} variant="compact" className="flex-1" />
          </div>
        ))}
      </div>
    </div>
  )
}
