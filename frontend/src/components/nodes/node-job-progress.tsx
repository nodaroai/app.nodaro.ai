import { tx } from "@/lib/i18n"
import { useNodeTextDir } from "./node-text-dir";

/** Compact progress bar shown inside node components during job execution. */
export function NodeJobProgress({ progress, recovering }: { progress?: number; recovering?: boolean }) {
  // Status text only. The column below keeps its LTR-canvas geometry — a
  // column's main axis is unaffected by `direction`, and the bar is centered.
  const textDir = useNodeTextDir();
  if (progress == null || progress <= 0) return null;
  return (
    <div className="flex flex-col items-center gap-1 w-full px-8">
      <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full transition-all duration-300 ease-out ${recovering ? "bg-amber-500" : "bg-[#ff0073]"}`}
          style={{ width: `${progress}%` }}
        />
      </div>
      <span dir={textDir} className="text-[11px] text-muted-foreground">
        {recovering ? tx("node.recovering") : `${progress}%`}
      </span>
    </div>
  );
}
