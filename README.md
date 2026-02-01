# SceneNode.ai

Visual workflow platform for AI video generation. Build video creation pipelines by connecting nodes, with each node representing an AI operation (image generation, video creation, voiceover, etc.).

## Current Status

**Phase 1.3 (Execution) - Complete.** Full DAG execution engine with topological sort, parallel execution at each level, and sequential dependency waiting. All AI nodes executable: image generation (google/nano-banana), video generation (minimax/video-01), video-to-video, text-to-video, text-to-speech (ElevenLabs via Replicate), script generation (Gemini 2.5 Flash), and combine videos (FFmpeg). Reference image chaining for character consistency. Single-node and full workflow execution with version history. Generate Script node with storyboard preview, fullscreen modal, per-scene image generation, and one-click expand to full video pipeline. Delete confirmation dialog for all version deletions.

## Features

### Visual Workflow Editor
- Drag-and-drop node-based editor built on React Flow
- Single input handle per node with field mapping in the config panel
- Connect multiple source nodes to one target and map which source feeds which field
- Dropdown filtering by compatible node types
- Provider cascading dropdowns: Category -> Provider -> Model
- Graph-based workflows: branching, merging, multiple inputs/outputs
- Manual save with unsaved changes indicator and exit confirmation

### 28 Node Types

| Category | Nodes |
|----------|-------|
| **Input** | Text Prompt, Upload Image, Upload Video, RSS Feed |
| **Parameter** | Provider, Duration, Aspect Ratio, Tone, Style Guide, Scene Count, Motion, Camera Motion |
| **AI** | Generate Script, Generate Image, Image to Video, Video to Video, Text to Video, Text to Speech, QA Check |
| **Processing** | Combine Videos, Add Audio, Extract Audio, Mix Audio, Add Captions, Resize Video, Trim Video, Adjust Volume |
| **Output** | Save to Storage, Webhook Output |

### Dashboard
- Projects with folders
- Workflow management
- Mobile responsive (collapsible sidebar, touch targets, pinch-to-zoom)
- Light/Dark mode

### Authentication
- Google OAuth via Supabase

## Tech Stack

| Layer | Technology | Status |
|-------|-----------|--------|
| Frontend | Next.js 14 (App Router) | Built |
| UI Components | shadcn/ui + Tailwind CSS | Built |
| Visual Editor | React Flow | Built |
| State Management | Zustand | Built |
| Database + Auth | Supabase (PostgreSQL) | Built |
| Backend | Fastify (Node.js/TypeScript) | Built |
| Queue | Redis + BullMQ | Built |
| Storage | Cloudflare R2 | Built |
| AI (Image) | google/nano-banana via Replicate | Built |
| AI (Video) | minimax/video-01 via Replicate | Built |
| AI (Script) | google/gemini-2.5-flash via Replicate | Built |
| AI (TTS) | elevenlabs/turbo-v2.5 via Replicate | Built |
| Video Processing | FFmpeg (combine videos, transitions) | Built |

## Quick Start

### Requirements
- Node.js 18+
- Supabase project (free tier works)
- AI provider API keys (Replicate for MVP)

### Installation

```bash
git clone https://github.com/scenenode/scenenode.git
cd scenenode

cp .env.example .env
# Edit .env with your credentials (see below)

# Frontend
cd frontend
npm install
npm run dev

# Backend (in separate terminal)
cd backend
npm install
npm run dev

# Open http://localhost:3000
```

### Environment Variables

```bash
# Frontend (.env in frontend/)
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...

# Backend (.env in backend/)
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
REDIS_URL=redis://localhost:6379
REPLICATE_API_TOKEN=r8_xxxxx
```

### Getting API Keys

- **Supabase**: https://supabase.com/dashboard - Create a project, copy URL and anon key
- **Replicate**: https://replicate.com/account/api-tokens - Provides access to Nano Banana (images), video models, and ElevenLabs TTS

## Project Structure

```
scenenode/
├── frontend/                     # Next.js 14
│   ├── src/
│   │   ├── app/
│   │   │   ├── (auth)/           # Login, signup
│   │   │   └── (main)/           # Dashboard, projects, editor
│   │   ├── components/
│   │   │   ├── editor/           # Workflow canvas, config panel, toolbar, script-preview-modal, expand-storyboard-dialog
│   │   │   ├── nodes/            # 28 node components + base-node
│   │   │   └── ui/               # shadcn/ui components (incl. delete-confirmation-dialog)
│   │   ├── hooks/
│   │   │   ├── use-workflow-store.ts  # Zustand workflow state
│   │   │   ├── use-auth.ts           # Auth hook
│   │   │   └── use-projects-store.ts # Projects state
│   │   ├── lib/
│   │   │   ├── providers-config.ts   # Provider/model mappings
│   │   │   ├── supabase.ts           # Supabase client
│   │   │   └── utils.ts
│   │   └── types/
│   │       └── nodes.ts              # All node types + definitions
│   └── package.json
├── backend/                      # Fastify (Node.js/TypeScript)
│   ├── src/
│   │   ├── routes/               # API endpoints
│   │   ├── providers/            # AI providers + FFmpeg video processing
│   │   ├── services/             # Business logic
│   │   ├── workers/              # BullMQ job workers
│   │   └── lib/                  # Config, Supabase, Redis, R2 storage
│   ├── package.json
│   └── tsconfig.json
├── supabase/
│   └── migrations/               # Database schema
├── CLAUDE.md                     # Full project specification
└── README.md
```

## Development

```bash
# Frontend
cd frontend
npm install
npm run dev      # Development server
npm run build    # Production build
npm run lint     # ESLint

# Backend
cd backend
npm install
npm run dev      # Development server
npm run worker   # BullMQ worker (requires Redis)
```

### Testing

```bash
# Frontend
cd frontend
npm test

# Backend
cd backend
npm test
```

## API

The backend exposes a REST API at `http://localhost:8000`:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/v1/projects` | GET, POST | List/create projects |
| `/v1/projects/:id` | GET, PATCH, DELETE | Project CRUD |
| `/v1/projects/:id/workflows` | GET, POST | List/create workflows |
| `/v1/workflows/:id` | GET, PATCH, DELETE | Workflow CRUD |
| `/v1/workflows/:id/run` | POST | Execute workflow |
| `/v1/jobs` | GET | List jobs |
| `/v1/jobs/:id` | GET | Job status |
| `/v1/text-to-speech` | POST | Generate audio from text |
| `/v1/combine-videos` | POST | Combine videos with FFmpeg transitions |
| `/v1/render` | POST | Quick render (one-shot) |

Full API documentation: see [CLAUDE.md](./CLAUDE.md)

### Execution Engine
- **DAG-based execution**: Topological sort (Kahn's algorithm) determines execution order
- **Parallel execution**: Nodes at the same dependency level run simultaneously via Promise.allSettled
- **Sequential dependencies**: Levels execute one after another, waiting for completion
- **Reference image chaining**: Generate Image → Generate Image passes output as reference for character consistency
- Image generation via google/nano-banana (Replicate) with smart translation (Hebrew, etc.)
- Video generation via minimax/video-01 (Replicate)
- Video-to-video continuation/style reference
- Text-to-speech via elevenlabs/turbo-v2.5 (Replicate) with 26 voice options
- Generated results display directly in nodes with version history
- Delete individual results with confirmation dialog
- Global video autoplay toggle in editor toolbar
- **Generate Script**: AI script generation via Gemini 2.5 Flash, outputs scenes with visual descriptions, actions, moods, and durations
- **Storyboard Preview**: Inline scene strip in Generate Script node showing thumbnails, scene numbers, and durations
- **Storyboard Modal**: Full-screen view with per-scene image generation, "Generate All Images" batch, and version history per scene
- **Expand to Nodes**: One-click expansion of storyboard into Generate Image + Image to Video nodes per scene, optional Combine Videos node, horizontal/vertical layout, auto-run support, intelligent credit estimation accounting for existing images
- **Combine Videos**: FFmpeg-based video concatenation with Cut/Fade/Dissolve transitions, xfade filter for 2-video transitions, version history, Run button
- Per-node Run button (hover to reveal, hanging tab below node)
- **Delete Confirmation Dialog**: Reusable component for all version history deletions across all node types
- Asset upload to Cloudflare R2
- Redis + BullMQ job queue with progress tracking

## Planned Features

- Project-level characters for visual consistency
- Style presets library
- Build from Prompt (auto-generate workflow from text description)
- Workflow export/import as JSON
- API access for n8n/Make.com integration

## License

Sustainable Use License - See [LICENSE](./LICENSE)

## Issues

Report bugs and request features at https://github.com/scenenode/scenenode/issues
