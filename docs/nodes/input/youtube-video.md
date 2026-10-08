# Video URL

> Paste a link from YouTube, TikTok, Instagram, Facebook or X and get the video as a file your workflow can use.

## Overview

The Video URL node turns a social video link into a stored video file. Paste the link and the node fetches the video on its own — there is nothing to click for a TikTok, a Reel, a Short or any other short clip. The file lands in your library, and every downstream node (trim, captions, video analysis, motion transfer, video-to-video, …) receives that file, not the web page.

A direct link to a video file (`.mp4`, `.webm`, `.mov`, `.avi`) is also accepted. It is passed through as it is — nothing is downloaded.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| URL | Text input | — | A video link from a supported platform, or a direct video file link |
| From / To | Time (`1:30`, `1:02:03` or seconds) | `0:00` – `1:00` | Shown for a long YouTube video: the part to download |

Supported platforms: YouTube, Facebook, TikTok, Instagram, X/Twitter.

## How a link is fetched

| Link | What happens |
|------|--------------|
| TikTok, Instagram, Facebook, X | Downloads the whole video as soon as the link is pasted. |
| YouTube, shorter than 4 minutes | Downloads the whole video as soon as the link is pasted, at up to 1080p. |
| YouTube, 4 minutes or longer (or a length that could not be read) | The node shows the video's length and asks: **Download this part** (From / To) or **Download whole video**. Nothing is downloaded until you choose. |
| YouTube live stream | Cannot be downloaded — try again after it ends. |
| Direct video file link | Passed through as it is. |

The clip you get for a chosen part may include a few extra seconds on each side — the cut follows the video's keyframes. Use a Trim Video node after it when you need an exact cut.

After a YouTube video is downloaded you can fetch a different part of the same link from the node's settings (**Download a different part**).

## Running a workflow

Run never reads a link that was not fetched yet. If a Video URL node that feeds the run still has no file, Run downloads it first and then starts; you see the node's own progress bar meanwhile, and **Cancel** on the message leaves the wait (the download itself carries on). Two cases stop the run with a message naming the node instead:

- a long YouTube video with no part chosen — choose one (or the whole video) and run again;
- a download that failed — the message says why.

Run only fetches what it needs:

- a Video URL node that is not connected to anything in the run is left alone;
- Transcribe, Suno Cover and Dubbing use the link's sound, not its picture — a run where they are the only readers never waits for a video download, however long the video is.

Opening a workflow never starts a download. A node that was mid-download when the page was closed picks that same download back up if it is still running; otherwise it shows **Download Video** again.

## Inputs & Outputs

**Inputs:** None (this is a source node)

**Outputs:**
- Video — the downloaded file (or the direct file link you pasted)

The node also fetches the link's audio track in the background; Suno Cover and Transcribe use it when they are connected to this node.

## When a download fails

| Message | What it means |
|---------|---------------|
| The video came through without its sound | The source answered with a sound-less copy. Try again in a moment. If the video really has no sound, choose **Download without sound**. |
| This video is private | Ask the owner to make it public. |
| This video is age-restricted | It cannot be downloaded. |
| This video isn't available in the region we download from | The source blocks it by location. |
| The connection dropped while downloading | Try again — the download may already be finished, and the retry picks it up. |
| Too many downloads are running at once | An account can run 4 downloads at a time. Wait for one to finish, then try again. |
| Couldn't fetch this video | Check that the link opens in a private browser window. |

Hover the message to see the source's own wording.

## Common Use Cases

- Import a YouTube video, or a part of one, for re-editing, captions or analysis
- Download a TikTok or a Reel for a remix or a transformation
- Source a reference video for Motion Transfer
- Pull frames out of a social video for Image to Video

## Tips

- For audio only from YouTube, use the Reference Audio node instead
- Only download videos you have the right to use
- The downloaded file counts toward your storage; delete it from the Library when you no longer need it

## As an app input

A Video URL node can be exposed as an input of a published app, so the app's user pastes their own link (their episode) instead of uploading a file. The app's page downloads a post link in the field before Run, with the same rules as above (a long YouTube video asks for a part), and takes any other web link as it is; when only Transcribe, Suno Cover, Dubbing or Content Recipe read the link, nothing is downloaded there. Over MCP, the SDK and the API the input is a link too, and the server downloads a post link itself before the first node runs, by the same rules (a YouTube video of 4 minutes or more only as a part you name). See [Video URL inputs](../../embed-app-guide.md#video-url-inputs) for the full rules.

## Building workflows through the API

A Video URL node outputs a real file only after it was downloaded — a workflow written through the API or by an agent carries just the link. A run started from the API, MCP or the SDK downloads a post link the workflow holds (or the run's request sets) before the first node runs, whenever a node after it needs the file, by the same rules as above: a YouTube video of 4 minutes or more is downloaded only as a part, named by `sectionStartSec` and `sectionEndSec` on the node or in `inputOverrides`, and without one the run is refused before anything runs or is charged (a Render final refused for the same reason has already charged its preview, so it says nothing more was charged). The file a run downloads is kept on that run, so Render final after it, and a run picked up again after a deploy, use the same file instead of downloading it again; a repeated run downloads it afresh, and the file is not written back to the node. To download a video yourself first, import it with `POST /v1/download-video` (see [API integration](../../api-integration.md)) and put the returned file URL in an Upload Video node, or in this node's URL field — a direct file link passes through.
