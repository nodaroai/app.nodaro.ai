# RSS Feed

> Pull content from RSS/Atom feeds for automated content pipelines.

## Overview

The RSS Feed node fetches content from an RSS or Atom feed URL. Select a specific item by index to extract its title, description, and link. Use it as a starting point for automated content generation workflows triggered by new blog posts or news articles.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| Feed URL | Text input | — | URL of the RSS or Atom feed |
| Item Index | Number | 0 | Which item to select (0 = most recent) |

## Inputs & Outputs

**Inputs:** None (this is a source node)

**Outputs:**
- Feed item content (title, description, link)

## Credit Cost

0 credits — always free.

## Best Practices

- Use index 0 for the most recent item in the feed
- Combine with Schedule Trigger for fully automated content pipelines
- Test the feed URL in a browser first to verify it returns valid RSS/Atom

## Common Use Cases

- Auto-generate social media posts from new blog articles
- Create video summaries of daily news feeds
- Feed article content to AI Agent for rewriting or summarization
- Automated content curation pipelines

## Tips

- Pair with Schedule Trigger to check the feed on a recurring schedule
- Connect to AI Agent to summarize or rewrite feed content before further processing
