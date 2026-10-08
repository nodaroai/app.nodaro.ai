/** How long the link must sit still before it is fetched. A link is usually
 *  pasted, but it CAN be typed — and `instagram.com/reel/A`, `/reel/AB`, … are
 *  each a valid link, so without the pause every keystroke was a download.
 *  Its own module so the app runner's card can read it without importing the
 *  canvas's workflow store (`video-link-ingest.ts`). */
export const VIDEO_LINK_INGEST_DEBOUNCE_MS = 700
