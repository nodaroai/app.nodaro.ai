# Video URL

> Paste a link to where your video is and get the video as a file your workflow can use.

## Overview

The Video URL node turns a link to a video's page into a stored video file. Paste the link, confirm the content rights declaration for it, and the node fetches the video on its own — there is nothing else to click for a short clip. The file lands in your library, and every downstream node (trim, captions, video analysis, motion transfer, video-to-video, …) receives that file, not the web page.

A direct link to a video file (`.mp4`, `.webm`, `.mov`, `.avi`) is also accepted. It is passed through as it is — nothing is downloaded, and nothing is asked.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| URL | Text input | — | A link to the video's page, or a direct video file link |
| Content rights | Checkbox | unticked | Shown for a video-page link while its video or its sound is still to fetch: you confirm the declaration (read it from the link under the box) for that one link. Nothing is fetched before it is ticked; a changed link unticks it. |
| From / To | Time (`1:30`, `1:02:03` or seconds) | `0:00` – `1:00` | Shown for a long video from a site whose video length the node reads first: the part to download |

A link the node cannot use is refused as soon as it is pasted, with a message.

## How a link is fetched

Nothing is fetched from a video-page link until you tick the content rights box for it; the tick starts the fetch. Some sites let the node read a video's length before anything downloads; for those, a long video is fetched in parts. Any other video-page link is downloaded whole, whatever its length.

| Link | What happens |
|------|--------------|
| A video-page link from a site whose length is not read first | Downloads the whole video as soon as the box is ticked. |
| A site whose length is read first — video shorter than 4 minutes | Downloads the whole video as soon as the box is ticked, at up to 1080p. |
| A site whose length is read first — video of 4 minutes or longer, or a length that could not be read | The node shows the video's length and asks: **Download this part** (From / To) or **Download whole video**. Nothing is downloaded until you choose. |
| A live stream | Cannot be downloaded — try again after it ends. |
| Direct video file link | Passed through as it is. |

Every fetch records your confirmation of the declaration for the link — the video, its sound, and a download started again after the server lost one each record their own, under the one box you ticked. The box is never saved with the workflow: whoever opens it next confirms for themselves.

The clip you get for a chosen part may include a few extra seconds on each side — the cut follows the video's keyframes. Use a Trim Video node after it when you need an exact cut.

After a video was downloaded in parts you can fetch a different part of the same link from the node's settings (**Download a different part**).

## Running a workflow

Run never reads a link that was not fetched yet. If a Video URL node that feeds the run still has no file, Run downloads it first and then starts; you see the node's own progress bar meanwhile, and **Cancel** on the message leaves the wait (the download itself carries on). Three cases stop the run with a message naming the node instead:

- the content rights box is not ticked for the link — tick it in the node (**Show** on the message takes you there) and run again;
- a long video (from a site whose length is read first) with no part chosen — choose one (or the whole video) and run again;
- a download that failed — the message says why.

Run only fetches what it needs:

- a Video URL node that is not connected to anything in the run is left alone;
- Transcribe, Suno Cover and Dubbing use the link's sound, not its picture — a run where they are the only readers never waits for a video download, however long the video is. When the node holds no sound yet (the box was not ticked when the link was pasted, or that fetch failed), Run fetches the sound first, under the same box.

Opening a workflow never starts a download. A node that was mid-download when the page was closed picks that same download back up if it is still running; otherwise it shows **Download Video** again, behind the box.

## Inputs & Outputs

**Inputs:** None (this is a source node)

**Outputs:**
- Video — the downloaded file (or the direct file link you pasted)

The node also fetches the link's audio track in the background, once the box is ticked; Suno Cover and Transcribe use it when they are connected to this node.

## When a download fails

| Message | What it means |
|---------|---------------|
| Your confirmation could not be recorded | The declaration changed since you read it (the box unticks: read the new text and tick again), or the confirmation could not be made. |
| This link can't be imported here | The site the link is from is not allowed on this deployment. |
| The video came through without its sound | The source answered with a sound-less copy. Try again in a moment. If the video really has no sound, choose **Download without sound**. |
| This video is private | Ask the owner to make it public. |
| This video is age-restricted | It cannot be downloaded. |
| This video isn't available in the region we download from | The source blocks it by location. |
| The connection dropped while downloading | Try again — the download may already be finished, and the retry picks it up. |
| Too many downloads are running at once | An account can run 4 downloads at a time. Wait for one to finish, then try again. |
| Couldn't fetch this video | Check that the link opens in a private browser window. |

Hover the message to see the source's own wording.

## Common Use Cases

- Import a video, or a part of a long one, for re-editing, captions or analysis
- Download a short clip for a remix or a transformation
- Source a reference video for Motion Transfer
- Pull frames out of a social video for Image to Video

## Tips

- For audio only, the Reference Audio node extracts the sound from some links
- Only import videos you hold the rights to, or the rights holder's permission for — that is what the box confirms
- The downloaded file counts toward your storage; delete it from the Library when you no longer need it

## As an app input

A Video URL node can be exposed as an input of a published app, so the app's user pastes their own link (their episode) instead of uploading a file. The app's page shows the content rights box under the field for a video-page link that still has something to import; the user ticks it for their link (a changed link unticks it). A link a node after it watches is then downloaded in the field before Run, with the same rules as above (a long video from a site whose length is read first asks for a part); any other web link is taken as it is; when only Transcribe or Suno Cover read the link, nothing is downloaded there — Run waits for the tick, confirms the link when pressed, and the server fetches the sound under that confirmation; when only Dubbing or Content Recipe read it, nothing is imported and no box is shown. Over MCP, the SDK and the API the input is a link too, and the server downloads a video-page link itself before the first node runs, by the same rules (from such a site, a video of 4 minutes or more only as a part you name); a confirmation goes in `inputOverrides` as the node's `rightsConfirmationId`. See [Video URL inputs](../../embed-app-guide.md#video-url-inputs) for the full rules.

## Building workflows through the API

A Video URL node outputs a real file only after it was downloaded — a workflow written through the API or by an agent carries just the link. A run started from the API, MCP or the SDK downloads a video-page link the workflow holds (or the run's request sets) before the first node runs, whenever a node after it needs the file, by the same rules as above: from a site whose length is read first, a video of 4 minutes or more is downloaded only as a part, named by `sectionStartSec` and `sectionEndSec` on the node or in `inputOverrides`, and without one the run is refused before anything runs or is charged (a Render final refused for the same reason has already charged its preview, so it says nothing more was charged). The fetch is an import of the link: the run makes it under the content rights confirmation the run request sets as the node's `rightsConfirmationId` in `inputOverrides`, made with `POST /v1/content-rights/confirm` for that link, for that run (one confirmation opens one download, within an hour — so it is never saved on the node, and one found there is dropped). Whether a run without one is refused is the deployment's setting (see [Content rights](../../api-integration.md#13i-content-rights-import-confirmations)). The file a run downloads is kept on that run, so Render final after it, and a run picked up again after a deploy, use the same file instead of downloading it again; a repeated run downloads it afresh, and the file is not written back to the node. To download a video yourself first, import it with `POST /v1/download-video` (see [API integration](../../api-integration.md)) and put the returned file URL in an Upload Video node, or in this node's URL field — a direct file link passes through.
