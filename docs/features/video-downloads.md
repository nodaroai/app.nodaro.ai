# Downloading a video

Some video models deliver a file most browsers cannot show correctly: HEVC in
10-bit, or an HDR picture (HLG or PQ). Nodaro keeps that file untouched as the
result's **original**, and stores a browser-friendly H.264 copy beside it.

- **Download gives you the original**: the file as the model made it, with
  its own extension (`.mp4`, `.mov`, `.webm` or `.mkv`). For some models it is
  HEVC 10-bit or HDR, and not every player opens it. A recent version of a
  dedicated video player or editor does.
- **The app plays the copy.** Previews on the canvas, in the Library, in app
  results and in thumbnails use the browser-friendly H.264 file. An HDR
  original's copy is converted to SDR. If the copy could not be made, the
  result is the original alone, and a browser that cannot play it shows a
  message and a Download button instead.

This holds wherever the app offers Download for a video result:

- the node on the canvas, and the message it shows for a video your browser
  cannot play;
- the Library browser in the editor;
- job history;
- the results list in a node's settings;
- loop and iteration results;
- a published app's results;
- the public gallery;
- the Download buttons of the agent widgets (MCP).

A video that is already H.264 8-bit has no separate original, so Download gives
that same file. A watermarked run keeps only its watermarked file, and an
upload or a plugin's video has no separate original either: each downloads as
before. A Library item gives the original when the job that made it still has
one; an item whose job you deleted, or that is in the Trash, gives the copy.

Downloads are named after the stored file: `<id>.mp4` for a copy or a
browser-safe original, `<id>-original.mov` (or `.mp4`, `.webm`, `.mkv`) for a
kept original.

For the API, SDK and MCP fields (`originalVideoUrl`, `videoPreviewUnavailable`)
see [Video outputs: the original and its preview](../api-integration.md#video-outputs-original-and-preview).
How the original is kept is in the
[design note](../design/video-original-and-preview.md).
