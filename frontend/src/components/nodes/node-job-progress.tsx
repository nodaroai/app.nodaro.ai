/** Compact progress bar shown inside node components during job execution. */
export function NodeJobProgress({ progress }: { progress?: number }) {
  if (progress == null || progress <= 0) return null;
  return (
    <div className="flex flex-col items-center gap-1 w-full px-8">
      <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-[#ff0073] transition-all duration-300 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>
      <span className="text-[11px] text-muted-foreground">
        {progress}%
      </span>
    </div>
  );
}
