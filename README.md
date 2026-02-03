# SceneNode.ai

Visual workflow platform for AI video generation. Build video creation pipelines by connecting nodes, with each node representing an AI operation (image generation, video creation, voiceover, etc.).

## Current Status

**Phase 1.3 (Execution) - Complete.** Full DAG execution engine with topological sort, parallel execution at each level, and sequential dependency waiting. 32 node types across 5 categories. All AI nodes executable: image generation (google/nano-banana), video generation (minimax/video-01, google/veo-2, google/veo-3), video-to-video, text-to-video, text-to-speech (ElevenLabs via Replicate), script generation (Gemini 2.5 Flash), music generation (MusicGen/MiniMax/Lyria/Bark), text-to-audio (TangoFlux/Tango/AudioLDM/Bark), and 8 FFmpeg processing nodes. VEO 3 with native audio generation toggle. Asset management system with characters, locations, and objects -- import across projects/workflows, extract references from generated images. Reference image chaining for visual consistency. Single-node and full workflow execution with version history. Character Node with portrait generation/upload, individual asset generation (expressions, poses, angles, lighting), and character gallery. Scene Node with 4-step Wizard UI (Story, Image, Audio, Video), Script Connection with scene import and auto-sync, per-dialogue audio generation with voice selection, video generation with provider selection and duration, and Generated Prompt accordion display.

## Features

### Visual Workflow Editor
- Drag-and-drop node-based editor built on React Flow
- Single input handle per node with field mapping in the config panel
- Connect multiple source nodes to one target and map which source feeds which field
- Dropdown filtering by compatible node types
- Provider cascading dropdowns: Category -> Provider -> Model
- Graph-based workflows: branching, merging, multiple inputs/outputs
- Manual save with unsaved changes indicator and exit confirmation

### 32 Node Types

| Category | Nodes |
|----------|-------|
| **Input (5)** | Text Prompt, Upload Image, Upload Video, RSS Feed, Reference Audio |
| **Parameter (8)** | Provider, Duration, Aspect Ratio, Tone, Style Guide, Scene Count, Motion, Camera Motion |
| **AI (9)** | Generate Script, Generate Image, Image to Video, Video to Video, Text to Video, Text to Speech, Generate Music, Text to Audio, QA Check |
| **Processing (8)** | Combine Videos, Merge Video & Audio, Extract Audio, Mix Audio, Add Captions, Resize Video, Trim Video, Adjust Volume |
| **Output (2)** | Save to Storage, Webhook Output |

### Asset Management
- Define characters, locations, and objects with reference images or text descriptions
- Import assets across projects and workflows (browse by project or "Show all assets")
- Filter by category: All | Characters | Locations | Objects
- Extract references directly from generated images (scissors tool on Generate Image output)
- Auto-attach imported assets to Generate Image nodes
- Category-aware execution: reference images sent to AI provider, descriptions appended to prompts
- Visual indicators: category badges (cyan=location, emerald=object), asset count on nodes

### Character Node
- Generate main character portrait (single front view) or upload image from computer
- Generate character assets individually for better quality and consistency:
  - **Angles** (3): front view, side view, back view
  - **Expressions** (6): neutral, smile, angry, surprised, sad, talking
  - **Poses** (4): standing, walking, sitting, running
  - **Lighting** (3): daylight, night, dramatic
- Sequential per-variant API calls with progressive UI updates
- Collapsible asset sections with accordion UI
- Click-to-enlarge lightbox for all character images (portal-based, Escape/click/X to close)
- Run button on hover (delete only available via Character Page modal)
- Version handling: auto-versioning for duplicate character names with data clearing

### Character Library & Persistence
- **Database persistence**: characters saved to Supabase `characters` table, persist across sessions
- **Character Library (Gallery)**: popup modal showing only database characters (not canvas nodes)
- Click character thumbnail to open Character Page modal
- "+" button adds character to canvas (can add same character multiple times)
- Duplicate node on canvas clears `characterDbId` (creates fresh unpersisted character)
- Delete node from canvas does NOT delete from database (safe to remove and re-add)
- **Character Page modal**: full-page view with tabs (Main, Expressions, Poses, Lighting, Angles, Custom)
- "+" button on any image adds it to canvas as Generate Image node with result pre-set
- Dialogs close automatically after adding image to canvas
- **Custom variations**: generate custom character images with free-form text prompts
- **Delete assets**: inline confirmation per image, delete individual assets from any tab
- **Delete character permanently**: "Delete Forever" removes from database and canvas
- Drag and drop character images to canvas creates Generate Image node at drop position

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
| AI (Video) | minimax/video-01, google/veo-3 via Replicate | Built |
| AI (Script) | google/gemini-2.5-flash via Replicate | Built |
| AI (TTS) | elevenlabs/turbo-v2.5 via Replicate | Built |
| AI (Music) | MusicGen, MiniMax, Lyria, Bark via Replicate | Built |
| AI (Audio) | TangoFlux, Tango, AudioLDM, Bark via Replicate | Built |
| Video/Audio Processing | FFmpeg (merge, trim, resize, extract, mix, captions) | Built |

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
│   │   │   ├── nodes/            # 32 node components + base-node
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
| `/v1/generate-music` | POST | Generate music (MusicGen/MiniMax/Lyria/Bark) |
| `/v1/text-to-audio` | POST | Generate sound effects (TangoFlux/Tango/AudioLDM/Bark) |
| `/v1/merge-video-audio` | POST | Merge video and audio tracks with volume control |
| `/v1/extract-youtube-audio` | POST | Extract audio from YouTube URL |
| `/v1/render` | POST | Quick render (one-shot) |
| `/v1/characters` | GET | List characters by projectId |
| `/v1/characters` | POST | Create or update character |
| `/v1/characters/:id` | DELETE | Delete character permanently |

Full API documentation: see [CLAUDE.md](./CLAUDE.md)

### Execution Engine
- **DAG-based execution**: Topological sort (Kahn's algorithm) determines execution order
- **Parallel execution**: Nodes at the same dependency level run simultaneously via Promise.allSettled
- **Sequential dependencies**: Levels execute one after another, waiting for completion
- **Reference image chaining**: Generate Image → Generate Image passes output as reference for visual consistency
- **Asset management**: Characters, locations, objects attached to nodes; reference images and descriptions sent to AI providers
- Image generation via google/nano-banana (Replicate) with smart translation (Hebrew, etc.)
- Video generation via minimax/video-01, google/veo-3 (Replicate)
- **VEO 3 native audio**: `generate_audio` toggle generates AI audio from prompt; disable for custom audio via Merge Video & Audio node
- Video-to-video continuation/style reference
- Text-to-speech via elevenlabs/turbo-v2.5 (Replicate) with 26 voice options
- Generated results display directly in nodes with version history
- Delete individual results with confirmation dialog
- Global video autoplay toggle in editor toolbar
- **Generate Script**: AI script generation via Gemini 2.5 Flash, outputs scenes with visual descriptions, actions, moods, and durations
- **Storyboard Preview**: Inline scene strip in Generate Script node showing thumbnails, scene numbers, and durations
- **Storyboard Modal**: Full-screen view with per-scene image generation, "Generate All Images" batch, version history per scene, fully editable scene fields (resizable textareas), scene management (add/delete/reorder via drag-and-drop), Create Scene Node per scene
- **Expand to Nodes**: One-click expansion of storyboard into Scene Nodes (recommended) or Pipeline Nodes per scene, optional Combine Videos node, horizontal/vertical layout, auto-run support, intelligent credit estimation accounting for existing images
- **Combine Videos**: FFmpeg-based video concatenation with Cut/Fade/Dissolve transitions, xfade filter for 2-video transitions, version history, Run button
- **Generate Music**: AI music generation with 4 providers (MusicGen, MiniMax, Lyria, Bark), genre/mood selection, instrumental mode, lyrics support
- **Text to Audio**: Sound effects generation via TangoFlux (default), Tango, AudioLDM, Bark; for ambient sounds, SFX, background audio
- **Reference Audio**: YouTube URL with thumbnail preview, audio extraction, connects to Generate Music as reference input for MiniMax
- **FFmpeg Processing Nodes (8)**: Merge Video & Audio (multi-track mixer with volume control), Extract Audio, Trim Video, Resize Video, Adjust Volume, Add Captions, Mix Audio -- all use FFmpeg, not AI providers
- Per-node Run button (hover to reveal, hanging tab below node)
- **Delete Confirmation Dialog**: Reusable component for all version history deletions across all node types
- **Scene Node**: Cinematic control center with 4-step wizard (Story, Image, Audio, Video), smart prompt builder with priority-based truncation, Script Connection with auto-sync, per-dialogue TTS with 26 voices, video generation with provider selection (minimax/veo/veo3/kling/runway/pika), Image/Video tab toggle with version history
- Asset upload to Cloudflare R2
- Redis + BullMQ job queue with progress tracking

## Planned Features

- Style presets library
- Build from Prompt (auto-generate workflow from text description)
- Workflow export/import as JSON
- API access for n8n/Make.com integration

## License

Sustainable Use License - See [LICENSE](./LICENSE)

## Issues

Report bugs and request features at https://github.com/scenenode/scenenode/issues
