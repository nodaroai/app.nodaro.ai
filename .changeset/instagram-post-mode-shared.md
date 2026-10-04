---
"@nodaro/shared": minor
---

Add a `post` mode to the Instagram scrape vocabulary: `INSTAGRAM_SCRAPE_MODES` gains `"post"` (exactly the linked posts, whatever their age), `instagramPostLink` canonicalises an Instagram post link (`/p/`, `/reel/`, `/reels/`, `/tv/`, with or without scheme, subdomain, username segment or query string) or returns `null`, and `instagramRequestedCount` gives the posts a request asks for per source (one per link in post mode). `splitInstagramTargets` takes an optional `mode` (default `"profile"`, so existing calls behave as before); in post mode it keeps only post links, canonical and deduped by their case-sensitive shortcode. `instagramScrapeSources`, `instagramScrapeCreditIdFromNode` and `resolveInstagramScrapeCreditId` read the mode, so a post-mode request bills one post per link whatever its `count` says.
