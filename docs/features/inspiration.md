# Inspiration

**Inspiration** is your wall of saved posts: the posts you found with
[Social Search](../nodes/input/social-search.md) and want to come back to, each
with your own note and tags. It is a page in the sidebar (Activity →
Inspiration) on Nodaro Cloud, in preview for admins.

## Saving a post

After a Social Search run, open **Pick posts** on the node. Every card has a
bookmark in its top corner: click it to save the post to Inspiration, click it
again to remove the save. Saving does not pick the post, and picking does not
save it; the two are separate.

A save keeps:

- a snapshot of the post as it was when you saved it: the link, who posted it,
  when, the words and the numbers (they change on the platform; your copy does
  not)
- a copy of the post's picture in your storage, because the platform's own
  picture links stop working within days. The copy counts toward your storage,
  does not appear in the media picker, and follows the same storage rules as
  your other files (see
  [media retention](../api-integration.md#8b-pay-as-you-go-accounts)). If it
  is ever cleaned up, the card shows the platform's picture instead.
- your note and tags

Saving the same post again keeps the one save; it copies the picture again
only when the earlier copy is gone.

## The page

- **Find**: type words to search your notes and the posts' words; pick a
  platform; click a tag on any card to see only the posts with that tag.
- **Edit**: the pencil on a card changes its note and tags. Separate tags with
  commas; a save holds up to 10. Tags are stored in lower case, without `#`.
- **Remove**: the bin on a card removes the save, its note, its tags and the
  copy of its picture. The post itself stays on the platform. (A picture you
  have since added to your library is kept.)

Saving is free; it does not use credits.

## From code

The same saves are available over the API (`/v1/saved-posts`, see
[API integration](../api-integration.md#16b-saved-posts-inspiration-wall)), the
SDK (`client.savedPosts`, see the [SDK reference](../sdk-reference.md#clientsavedposts)),
the CLI (`nodaro saved-posts`, see [CLI](../cli.md)) and MCP (`save_post` and
`list_saved_posts`, see [MCP tools](../mcp/tools.md#save_post)).
