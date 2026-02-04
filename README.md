# SceneNode.ai

Visual workflow platform for AI video generation. Build video creation pipelines by connecting nodes, with each node representing an AI operation (image generation, video creation, voiceover, etc.).

## Current Status

**Phase 1.3 (Execution) - Complete.** Full DAG execution engine with topological sort, parallel execution at each level, and sequential dependency waiting. 37 node types across 10 categories. All AI nodes executable: image generation (google/nano-banana), video generation (minimax/video-01, google/veo-2, google/veo-3), video-to-video, text-to-video, text-to-speech (ElevenLabs via Replicate), script generation (Gemini 2.5 Flash), music generation (MusicGen/MiniMax/Lyria/Bark), text-to-audio (TangoFlux/Tango/AudioLDM/Bark), and 8 FFmpeg processing nodes. VEO 3 with native audio generation toggle. Complete Asset Node System: Character (pink), Object (emerald), and Location (cyan) nodes with variant generation, database persistence with user_id isolation, galleries showing only the current user's assets, and **Refine feature** for generating cleaned-up variations of any asset. All asset types work as reference images when connected to Generate Image -- multiple assets can be connected together for complex scenes. Scene Node with 4-step Wizard UI (Story, Image, Audio, Video), Script Connection with scene import and auto-sync, per-dialogue audio generation with voice selection, video generation with provider selection and duration, and Generated Prompt accordion display. **New UI/UX**: #ff0073 accent color throughout, animated edges with flowing dot during execution, running node animation with blue base and pink rotating overlay, MiniMap showing actual node colors, and all nodes are resizable.

## Features

### Visual Workflow Editor
- Drag-and-drop node-based editor built on React Flow
- Single input handle per node with field mapping in the config panel
- Connect multiple source nodes to one target and map which source feeds which field
- Dropdown filtering by compatible node types
- Provider cascading dropdowns: Category -> Provider -> Model
- Graph-based workflows: branching, merging, multiple inputs/outputs
- Manual save with unsaved changes indicator and exit confirmation
- **All nodes resizable**: Drag corners or edges to resize any node

### UI/UX Design
- **Accent color**: #ff0073 (pink) used throughout the entire app
- **Primary buttons**: All default/primary buttons use #ff0073
- **Sidebar headers**: Section headers (INPUT, PARAMETER, AI, etc.) use #ff0073
- **Save/Run buttons**: Save, Execute, and Run buttons all use #ff0073 accent
- **MiniMap**: Shows each node in its actual category color:
  - Character = pink (#ec4899)
  - Object = emerald (#10b981)
  - Location = cyan (#06b6d4)
  - Scene = violet (#8b5cf6)
  - AI nodes = purple (#a855f7)
  - Input nodes = blue (#3b82f6)
  - Parameter nodes = indigo (#6366f1)
  - Processing nodes = amber (#f59e0b)
  - Output nodes = green (#22c55e)
- **MiniMap toggle**: Button to show/hide MiniMap

### Running Node Animation
- **Blue base border**: 3px solid #3b82f6 (1.5x thicker than normal)
- **Pink rotating overlay**: #ff0073 conic-gradient that spins around the node
- **Animated edges**: When a node is running, edges from it turn pink with dashed lines
- **Flowing dot**: Pink glowing dot (#ff0073) travels along the edge path using SVG animateMotion
- Activates automatically during workflow execution

### 37 Node Types

| Category | Nodes |
|----------|-------|
| **Input (5)** | Text Prompt, Upload Image, Upload Video, RSS Feed, Reference Audio |
| **Parameter (8)** | Provider, Duration, Aspect Ratio, Tone, Style Guide, Scene Count, Motion, Camera Motion |
| **AI (9)** | Generate Script, Generate Image, Image to Video, Video to Video, Text to Video, Text to Speech, Generate Music, Text to Audio, QA Check |
| **Processing (8)** | Combine Videos, Merge Video & Audio, Extract Audio, Mix Audio, Add Captions, Resize Video, Trim Video, Adjust Volume |
| **Scene (1)** | Scene |
| **Character (1)** | Character |
| **Object (1)** | Object |
| **Location (1)** | Location |
| **Utility (1)** | Sticky Note |
| **Output (2)** | Save to Storage, Webhook Output |

### Asset Management
- **Unified Asset Library**: Browse ALL user assets across all projects in one place
- **User isolation**: Each user sees only their own assets (user_id filtering on all queries)
- **Database persistence**: Assets saved to Supabase tables (characters, objects, locations)
- Filter by category: All | Characters | Locations | Objects, search by name
- **Extract from images**: Scissors button on generated images saves directly to database
- Category-aware execution: reference images sent to AI provider, descriptions appended to prompts
- Visual indicators: category badges (cyan=location, emerald=object), asset count on nodes
- **Combined references**: Connect Character + Object + Location nodes together for complex scenes
- **Thumbnails refresh**: Asset Library thumbnails update automatically when Page modals close

**How to use:**
1. Create new asset: "Create Character/Object/Location" buttons in sidebar
2. Browse all assets: "Asset Library" in sidebar (shows all projects)
3. Extract from image: Scissors button on any generated image -> saves to DB
4. Use in workflow: Click "+" on asset or drag to canvas

### Refine Feature
- **Available on**: Character, Object, and Location Page modals
- **How it works**: Click "Refine" button to generate 4 cleaned-up variations of the main image
- **Selection UX**: Browse variations, view full-size in lightbox, then select your preferred version
- **Auto-save**: Selected image becomes the new main image and is saved to database
- **Library sync**: Asset Library thumbnails update automatically after refinement

**Refine prompts (optimized per asset type):**
- **Character**: Full body portrait, facing camera, neutral standing pose, clean white background, studio lighting
- **Object**: Product photo, centered, clean white background, studio lighting, front view
- **Location**: Wide establishing shot, clean composition, balanced lighting, no people, centered perspective

### Generate All Assets
- **Prominent CTA**: After refining an asset, a color-coded banner appears to generate all variations
- **One-click generation**: Creates all variant images with sequential API calls
- **Assets generated per type**:
  - **Character**: Expressions (6), Poses (4), Lighting (3), Angles (3) = 16 total
  - **Object**: Angles (5), Materials (6), Variations (5) = 16 total
  - **Location**: Time of Day (6), Weather (6), Angles (5) = 17 total
- **Progress feedback**: Toast notifications and loading state during generation
- **Proper accumulation**: Assets append to existing arrays (fixed closure bug)

**Complete Asset Workflow:**
1. Create asset via sidebar buttons or "+ Create new" menu
2. Generate or upload main image
3. Refine: Generate 4 clean variations, select the best one
4. Generate All Assets: Create all variant images with one click
5. Browse variants in Page modal tabs
6. Add to workflow: Use as reference image or add directly to canvas

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
- **Database persistence**: characters saved to Supabase `characters` table with `user_id`, persist across sessions
- **User isolation**: each user sees only their own characters (user_id filtering)
- **Character Library (Gallery)**: popup modal showing only database characters (not canvas nodes)
- Click character thumbnail to open Character Page modal
- "+" button adds character to canvas (can add same character multiple times)
- Duplicate node on canvas clears `characterDbId` (creates fresh unpersisted character)
- Delete node from canvas does NOT delete from database (safe to remove and re-add)
- **Character Page modal**: full-page view with tabs (Main, Expressions, Poses, Lighting, Angles, Custom)
- "+" button on any image adds it to canvas as Generate Image node with result pre-set
- Dialogs close automatically after adding image to canvas
- **Custom variations**: generate custom character images with free-form text prompts
- **Refine button**: generate 4 cleaned-up portrait variations, browse and select to replace main image
- **Delete assets**: inline confirmation per image, delete individual assets from any tab
- **Delete character permanently**: "Delete Forever" removes from database and canvas
- Drag and drop character images to canvas creates Generate Image node at drop position
- **Character as reference**: Connect Character node to Generate Image/Image to Video to use main portrait as reference (expressions/poses/etc. are NOT included)
- **Multiple characters**: Connect multiple Character nodes to pass ALL main portraits as references for consistent multi-character scenes

### Object Node
- Generate main object image (single front view) or upload image from computer
- Generate object assets individually for better quality and consistency:
  - **Angles** (5): front, side, top, back, three-quarter
  - **Materials** (6): wood, metal, glass, plastic, fabric, stone
  - **Variations** (5): clean, weathered, damaged, ornate, minimal
- Sequential per-variant API calls with progressive UI updates
- Collapsible asset sections with accordion UI
- Click-to-enlarge lightbox for all object images
- Run button on hover (delete only available via Object Page modal)
- **Object categories**: furniture, vehicle, weapon, food, clothing, electronics, nature, tool, other

### Object Library & Persistence
- **Database persistence**: objects saved to Supabase `objects` table with `user_id`, persist across sessions
- **User isolation**: each user sees only their own objects (user_id filtering)
- **Object Library (Gallery)**: popup modal showing only database objects (not canvas nodes)
- Click object thumbnail to open Object Page modal
- "+" button adds object to canvas (can add same object multiple times)
- **Object Page modal**: full-page view with tabs (Main, Angles, Materials, Variations, Custom)
- "+" button on any image adds it to canvas as Generate Image node with result pre-set
- **Custom variations**: generate custom object images with free-form text prompts
- **Refine button**: generate 4 cleaned-up product photo variations, browse and select to replace main image
- **Delete assets**: inline confirmation per image, delete individual assets from any tab
- **Delete object permanently**: "Delete Forever" removes from database and canvas
- **Object as reference**: Connect Object node to Generate Image to use main image as reference
- **Multiple objects**: Connect multiple Object nodes to pass ALL main images as references

### Location Node
- Generate main location image (single establishing shot) or upload image from computer
- Generate location assets individually for better quality and consistency:
  - **Time of Day** (6): dawn, morning, noon, afternoon, dusk, night
  - **Weather** (6): clear, cloudy, rain, storm, snow, fog
  - **Angles** (5): wide, medium, closeup, aerial, low-angle
- Sequential per-variant API calls with progressive UI updates
- Collapsible asset sections with accordion UI
- Click-to-enlarge lightbox for all location images
- Run button on hover (delete only available via Location Page modal)
- **Location categories**: indoor, outdoor, urban, nature, fantasy, sci-fi, historical, futuristic

### Location Library & Persistence
- **Database persistence**: locations saved to Supabase `locations` table with `user_id`, persist across sessions
- **User isolation**: each user sees only their own locations (user_id filtering)
- **Location Library (Gallery)**: popup modal showing only database locations (not canvas nodes)
- Click location thumbnail to open Location Page modal
- "+" button adds location to canvas (can add same location multiple times)
- **Location Page modal**: full-page view with tabs (Main, Time of Day, Weather, Angles, Custom)
- "+" button on any image adds it to canvas as Generate Image node with result pre-set
- **Custom variations**: generate custom location images with free-form text prompts
- **Refine button**: generate 4 cleaned-up establishing shot variations, browse and select to replace main image
- **Delete assets**: inline confirmation per image, delete individual assets from any tab
- **Delete location permanently**: "Delete Forever" removes from database and canvas
- **Location as reference**: Connect Location node to Generate Image to use main image as reference
- **Multiple locations**: Connect multiple Location nodes to pass ALL main images as references
- **Cyan color theme** for Location nodes (distinct from Character=pink, Object=emerald)

### Sticky Note Node
Canvas-level organizational node for adding notes and documentation to workflows. Stays behind all other nodes.

**Features:**
- **Always editable**: Textarea is always visible and editable (no double-click mode)
- **Background & Text color pickers**: Large 40x40px color pickers with labels
- **Font size dropdown**: Small, Normal, Large, X-Large options
- **Bold/Italic buttons**: Toggle formatting with visual active state
- **Text alignment**: Left, Center, Right buttons
- **Insert tools**: Link, Image, Table, and Bullet list buttons
- **Adaptive border**: Border auto-adjusts to contrast with background
- **Resizable**: Drag corners/edges (min 280x120)
- **Always behind**: CSS forces z-index -1 during drag/selection

**Default appearance**: Dark background (#2d2d44) with white text, default text "I'm a note"

**How to add:**
- Right-click on canvas -> "Add Sticky Note"
- Press Shift+S anywhere on canvas

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
| `/v1/generate-character` | POST | Generate main character portrait |
| `/v1/generate-character-asset` | POST | Generate character asset variant |
| `/v1/objects` | GET | List objects by projectId |
| `/v1/objects` | POST | Create or update object |
| `/v1/objects/:id` | DELETE | Delete object permanently |
| `/v1/generate-object` | POST | Generate main object image |
| `/v1/generate-object-asset` | POST | Generate object asset variant |
| `/v1/locations` | GET | List locations by projectId |
| `/v1/locations` | POST | Create or update location |
| `/v1/locations/:id` | DELETE | Delete location permanently |
| `/v1/generate-location` | POST | Generate main location image |
| `/v1/generate-location-asset` | POST | Generate location asset variant |

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

### Workflow Export/Import
- **3-dot menu** in editor toolbar with Export/Import options
- **Export with Assets**: Downloads JSON with all generated images embedded
- **Export as Template**: Downloads JSON without images (structure only)
- **Import workflow**: Upload JSON to restore workflow and assets

## Planned Features

- Style presets library
- Build from Prompt (auto-generate workflow from text description)
- API access for n8n/Make.com integration

## License

Sustainable Use License - See [LICENSE](./LICENSE)

## Issues

Report bugs and request features at https://github.com/scenenode/scenenode/issues
