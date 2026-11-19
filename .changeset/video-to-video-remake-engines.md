---
"@nodaro/sdk": minor
---

`nodes.run("video-to-video", …)` takes Video Remake's two engines as named providers, `"nodaro-prism"` and `"nodaro-pulse"` (`VideoToVideoRemakeParams`). For these the platform starts no job: the call resolves a `VideoToVideoRemakeQuote` (`quoteOnly: true`, Video Remake's quote, and the body to pass to `client.videoRemake.run`). Every other call is typed and answered as before, and a request naming no provider still runs the default. New exports: `VideoToVideoRemakeParams`, `VideoToVideoRemakeQuote`, `VideoToVideoRemakeRun` and the guard `isVideoToVideoRemakeQuote`. `nodes.quote("video-to-video", …)` accepts the same providers, and `nodes.runAndWait` rejects them with `quote_only_provider` before anything is sent.
