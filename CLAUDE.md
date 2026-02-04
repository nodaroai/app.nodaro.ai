# SceneNode.ai - Project Specification

## Overview

**SceneNode.ai** is a visual workflow platform for AI video generation. Users build video creation pipelines by connecting nodes (like n8n), with each node representing an AI operation (image generation, video creation, voiceover, etc.).

### Core Value Proposition
- **Visual Workflow Editor**: Drag-and-drop interface using React Flow
- **Build from Prompt**: Describe a video in plain text, get a complete workflow auto-generated (nodes + connections). Edit the generated flow as needed.
- **Graph-Based Workflows**: Not linear pipelines - support branching, merging, loops
- **Asset Management**: Define characters, locations, and objects with reference images or text descriptions. Assets are automatically injected into Generate Image nodes to maintain visual consistency across scenes. Import assets across projects and workflows, or extract references directly from generated images.
- **Style Presets**: Library of visual styles (system presets + user-created) for quick-start workflows. Each preset stores generation settings, aspect ratios, and style prompts.
- **Model Agnostic**: Swap AI providers without changing workflows
- **API First**: Full API access for n8n/Make.com integration
- **Self-hostable**: Open source with Sustainable Use License

### Target Users
1. **Direct Users**: Content creators building video workflows in the UI
2. **Automation Users**: n8n/Make.com users calling our API
3. **Self-hosters**: Developers running their own instance with their API keys

---

## Workflow Capabilities

**SceneNode is NOT a linear pipeline.** It's a full graph-based workflow system.

### Key Differentiator

| Other Tools | SceneNode |
|-------------|-----------|
| Linear: A → B → C → D | Graph: branching, merging, loops |
| One input → One output | Multiple inputs → Multiple outputs |
| Fixed structure | Unlimited flexibility |

### Supported Patterns

#### 1. Branching - Multiple Endings from Same Concept

```
                                    ┌─────────────┐     ┌─────────────┐
                                    │ 🎬 Video    │────▶│ 💾 Save     │
                               ┌───▶│ Happy End   │     │ "happy.mp4" │
                               │    └─────────────┘     └─────────────┘
                               │
┌─────────────┐    ┌─────────────┐
│ 📝 Prompt   │───▶│ 🎨 Generate │
│ "A knight   │    │  8 Scenes   │───┐
│  on quest"  │    │             │   │
└─────────────┘    └─────────────┘   │    ┌─────────────┐     ┌─────────────┐
                               │    │    │ 🎬 Video    │────▶│ 💾 Save     │
                               └───▶├───▶│ Sad End     │     │ "sad.mp4"   │
                                    │    └─────────────┘     └─────────────┘
                                    │
                                    │    ┌─────────────┐     ┌─────────────┐
                                    └───▶│ 🎬 Video    │────▶│ 💾 Save     │
                                         │ Plot Twist  │     │ "twist.mp4" │
                                         └─────────────┘     └─────────────┘

                                         3 videos from same concept!
```

#### 2. Reference Chain - Each Image as Reference for Next

```
┌─────────────┐
│ 🖼️ Upload   │
│ Knight.png  │─────────────────────────────────────────────────┐
└─────────────┘                                                 │
                                                                │ (reference)
┌─────────────┐     ┌─────────────┐     ┌─────────────┐        │
│ 📝 Scene 1  │────▶│ 🎨 Image 1  │────▶│ 🎬 Video 1  │        │
│ "Knight in  │     │ (ref: orig) │──┐  └─────────────┘        │
│  castle"    │     └─────────────┘  │                         │
└─────────────┘                      │                         │
                                     │ (output = next ref)     │
┌─────────────┐     ┌─────────────┐  │  ┌─────────────┐        │
│ 📝 Scene 2  │────▶│ 🎨 Image 2  │◀─┘─▶│ 🎬 Video 2  │        │
│ "Knight     │     │ (ref: img1) │──┐  └─────────────┘        │
│  fights"    │     └─────────────┘  │                         │
└─────────────┘                      │                         │
                                     │                         │
┌─────────────┐     ┌─────────────┐  │  ┌─────────────┐        │
│ 📝 Scene 3  │────▶│ 🎨 Image 3  │◀─┘─▶│ 🎬 Video 3  │────────┤
│ "Knight     │     │ (ref: img2) │     └─────────────┘        │
│  wins"      │     └─────────────┘                            │
└─────────────┘                                                │
                                                               ▼
                                                        ┌─────────────┐
                                                        │ 🔗 Combine  │
                                                        │  All Videos │
                                                        └─────────────┘

Character consistency maintained through the chain!
```

#### 3. Multiple Inputs + Multiple Outputs

```
┌─────────────┐
│ 🖼️ Hero     │────┐
│ image       │    │
└─────────────┘    │
                   │     ┌─────────────┐     ┌─────────────┐
┌─────────────┐    ├────▶│ 🎨 Generate │────▶│ 🎬 TikTok   │───▶ 💾 9:16
│ 🖼️ Villain  │────┤     │ Battle Scene│     │ Version     │
│ image       │    │     └─────────────┘     └─────────────┘
└─────────────┘    │            │
                   │            │            ┌─────────────┐
┌─────────────┐    │            └───────────▶│ 🎬 YouTube  │───▶ 💾 16:9
│ 🖼️ Castle   │────┘                         │ Version     │
│ background  │                              └─────────────┘
└─────────────┘

         3 images in ──▶ 2 videos out (different formats)
```

#### 4. Series Generation from Single Template

```
┌─────────────┐     ┌─────────────┐
│ 📝 Template │     │ 🖼️ Character│
│ "Episode    │     │ Reference   │
│  structure" │     └──────┬──────┘
└──────┬──────┘            │
       │                   │
       ▼                   ▼
┌──────────────────────────────────┐
│      📋 Episode Generator        │
│         (Loop Node)              │
└──────────────────────────────────┘
       │
       ├────▶ Episode 1 ───▶ 💾
       │
       ├────▶ Episode 2 ───▶ 💾
       │
       ├────▶ Episode 3 ───▶ 💾
       │
       └────▶ Episode 4 ───▶ 💾

         Full series from one template!
```

### Capabilities Summary

| Capability | Supported | Phase |
|------------|-----------|-------|
| Multiple images as input | ✅ | MVP |
| Reference chain (image → reference for next) | ✅ | MVP |
| Branching (split to multiple directions) | ✅ | MVP |
| Merging (combine multiple branches) | ✅ | MVP |
| Multiple outputs (several videos) | ✅ | MVP |
| Different formats from same concept | ✅ | MVP |
| Loop/Batch (full series) | ✅ | Phase 2 |
| Build from Prompt (auto-generate workflow) | ✅ | MVP |
| Character consistency (project-level characters) | ✅ | MVP |
| Style presets (system + user-created) | ✅ | MVP |

### Build from Prompt

A button in the editor toolbar that takes a plain text description and auto-generates a complete workflow (nodes + edges). The user can then edit, rearrange, or extend the generated flow.

**How it works:**

1. User clicks "Build from Prompt" in the editor toolbar
2. A dialog appears with a text area: "Describe the video you want to create"
3. The description is sent to an LLM (Claude/Gemini) with a system prompt that understands SceneNode's node types
4. The LLM returns a JSON structure: `{ nodes: [...], edges: [...] }`
5. The workflow is loaded into the editor canvas
6. The original prompt is stored in `workflows.source_prompt` for reference

**Example:**

```
User prompt: "Create a 60-second children's story about a brave rabbit who saves
the forest from a storm. 5 scenes, narrator voice, word-highlight captions."

Generated workflow:
  Text Prompt → Generate Script (5 scenes) → Generate Image ×5 → Image to Video ×5
  → Combine Videos → Merge Video & Audio (ElevenLabs narrator) → Add Captions (word-highlight)
  → Save to Storage
```

The generated workflow is fully editable - users can change providers, adjust prompts, add/remove nodes, or restructure the graph.

### Asset Management (Characters, Locations, Objects)

Assets are stored in database tables (`characters`, `objects`, `locations`) with `user_id` isolation. Three categories:

| Category | Example | Purpose |
|----------|---------|---------|
| **Character** | "Sir Aldric" | Maintain character appearance across scenes |
| **Location** | "The Pyramids" | Consistent background/setting |
| **Object** | "Magic Sword" | Consistent prop appearance |

**Asset definition includes:**
- **Name**: e.g. "Sir Aldric", "The Pyramids"
- **Category**: character, location, or object
- **Reference image**: Source image URL (uploaded or generated)
- **Description**: Text description for context

**Unified Asset Library (`unified-asset-library.tsx`):**
- Shows ALL user assets across all projects (not filtered by current project)
- Filter tabs: All | Characters | Locations | Objects
- Search by name
- Click asset thumbnail to open detail modal (Character/Object/Location Page)
- "+" button adds asset to canvas as appropriate node type
- Located in sidebar under "Library" section
- Thumbnails refresh automatically when Page modals close (300ms delay for DB propagation)
- Uses `sourceImageUrl` field for thumbnail display

**How to use assets:**
1. **Create new asset**: Use "Create Character/Object/Location" buttons in sidebar
2. **Browse all assets**: Click "Asset Library" in sidebar (shows all projects)
3. **Extract from image**: Click scissors button on any generated image -> saves directly to database
4. **Use in workflow**: Click "+" on asset or drag to canvas

**Extract References (Scissors button):**
- Always visible on generated images (top-right corner, purple button)
- Opens ExtractReferencesModal for cropping/selecting regions
- Supports lasso (freeform) and rectangle selection modes
- **Saves directly to database** (characters/objects/locations tables) with user_id
- Shows "Saved to Library" indicator after successful save
- Extracted assets appear immediately in Asset Library

**Execution:**
- All asset types with `sourceImageUrl` are sent in the `image_input` array to Replicate
- Description labels are category-aware: "Include character 'X': ...", "Include location 'Y': ...", "Include object 'Z': ..."
- Both storyboard path and standalone node path support all asset categories

### Asset Node System (Character, Object, Location Nodes)

Three specialized node types for creating reusable visual assets with variant generation:

| Node Type | Color | Main Image | Variant Categories |
|-----------|-------|------------|-------------------|
| **Character** | Pink | Portrait (front view) | Expressions (6), Poses (4), Lighting (3), Angles (3) |
| **Object** | Emerald | Object (front view) | Angles (5), Materials (6), Variations (5) |
| **Location** | Cyan | Establishing shot | Time of Day (6), Weather (6), Angles (5) |

**Character Node Variants:**
- **Expressions**: neutral, smile, angry, surprised, sad, talking
- **Poses**: standing, walking, sitting, running
- **Lighting**: daylight, night, dramatic
- **Angles**: front, side, back

**Object Node Variants:**
- **Angles**: front, side, top, back, three-quarter
- **Materials**: wood, metal, glass, plastic, fabric, stone
- **Variations**: clean, weathered, damaged, ornate, minimal

**Location Node Variants:**
- **Time of Day**: dawn, morning, noon, afternoon, dusk, night
- **Weather**: clear, cloudy, rain, storm, snow, fog
- **Angles**: wide, medium, closeup, aerial, low-angle

**Database Persistence:**
- All assets saved to Supabase with `user_id` for ownership
- Each user sees only their own assets in galleries (user_id filtering)
- Assets persist across sessions and can be reused in any workflow
- Delete Forever removes asset from database permanently

**Gallery System:**
- Character Gallery, Object Gallery, Location Gallery in editor sidebar
- Shows thumbnails of all saved assets for the current user
- Click thumbnail to open full Page modal with all variants
- "+" button adds asset to canvas as a node

**Reference Image Usage:**
- When connected to Generate Image node, the asset's main image is used as reference
- Multiple asset nodes can be connected together (Character + Object + Location)
- All connected asset images are passed to Replicate as `image_input` array
- Enables complex scenes with consistent characters, objects, and backgrounds

**Custom Variations:**
- Each Page modal includes a Custom tab for free-form prompts
- Generate any variation with a text description
- Custom images saved alongside standard variants

**Refine Feature:**
- "Refine" button on Character, Object, and Location Page modals
- Generates 4 cleaned-up variations of the main asset image
- User can browse variations, view full-size in lightbox, then select one
- Selected image becomes the new main image and updates database
- Thumbnails in Asset Library refresh automatically after refinement

**Refine Prompts (optimized per asset type):**
- **Character**: Full body portrait, facing camera, neutral standing pose, clean white background, studio lighting, centered composition
- **Object**: Product photo, centered, clean white background, studio lighting, front view, professional product photography
- **Location**: Wide establishing shot, clean composition, balanced lighting, no people, centered perspective, cinematic photography

**Generate All Assets Feature:**
- After refining an asset, a prominent CTA appears to generate all variations with one click
- Color-coded CTAs match asset type: pink (Character), emerald (Object), cyan (Location)
- Assets generated per type:
  - **Character**: Expressions (6), Poses (4), Lighting (3), Angles (3) = 16 total
  - **Object**: Angles (5), Materials (6), Variations (5) = 16 total
  - **Location**: Time of Day (6), Weather (6), Angles (5) = 17 total
- Sequential generation with progress toast notifications
- Assets accumulate properly in local state before updating node data (fixed closure bug)
- Progressive UI updates as each asset completes

**Asset Workflow Summary:**
1. Create asset: "Create Character/Object/Location" buttons in sidebar
2. Generate or upload main image
3. Refine: Click "Refine" to generate 4 cleaned-up variations, select the best
4. Generate All: Click "Generate All Assets" to create all variant images
5. Browse: View all assets in the Page modal tabs (Main, Expressions, Poses, etc.)
6. Use: Add to canvas as Generate Image node, or connect asset node as reference

### Style Presets

Pre-configured visual style templates for quick-start workflows.

**System presets** (built-in):
- Children's Storybook, Anime, Photorealistic, Watercolor, Comic Book, Film Noir, etc.

**User presets** (custom):
- Users can save their current generation settings as a reusable preset
- Stored per user, accessible across all their projects

**Preset settings include:**
- Image provider + model
- Style prompt additions
- Aspect ratio
- Negative prompt
- Any provider-specific parameters

---

## Tech Stack

| Layer | Technology | Reason |
|-------|------------|--------|
| **Frontend** | Next.js 14 (App Router) | SSR, Vercel deploy, React ecosystem |
| **Visual Editor** | React Flow | Industry standard for node-based UIs |
| **Backend** | Fastify (Node.js/TypeScript) | Fast, TypeScript-native, same language as frontend |
| **Database** | Supabase (PostgreSQL) | RLS, Auth, Realtime, managed |
| **Queue** | Redis + BullMQ | Proven at scale, job flows, priorities |
| **Storage** | Cloudflare R2 | S3-compatible, no egress fees |
| **Auth** | Supabase Auth (Google OAuth) + API Keys | Gmail login for UI, API keys for automation |
| **Payments** | Paddle | Subscriptions + usage-based, handles VAT/tax globally |

### Why Node.js for Backend?

SceneNode does **API orchestration**, not ML inference. All AI work is HTTP calls to external providers (Replicate, ElevenLabs, etc.). This means:
- No need for Python's ML ecosystem (PyTorch, transformers, etc.)
- TypeScript end-to-end = shared types, single toolchain, faster development
- BullMQ works natively (no cross-language glue code)
- Simpler deployment and debugging

### AI Providers (Abstracted)

**MVP (via Replicate):**
| Category | Model |
|----------|-------|
| **Image Generation** | google/nano-banana-pro |
| **Video Generation** | google/veo-2 (VEO), google/veo-3 (VEO 3) |
| **Script/QA** | google/gemini-2.5-flash |

**Phase 2+ (additional providers):**
| Category | Providers |
|----------|-----------|
| **Image Generation** | Flux, DALL-E |
| **Video Generation** | Kling, Runway, Pika |
| **Voice** | ElevenLabs, PlayHT |
| **Script/QA** | Claude, GPT |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND                                 │
│                    Next.js 14 (Vercel)                          │
│                                                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │   Editor    │  │  Dashboard  │  │   Settings  │              │
│  │ (React Flow)│  │  (Projects) │  │  (Billing)  │              │
│  └─────────────┘  └─────────────┘  └─────────────┘              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                          API LAYER                               │
│                    Fastify (Railway)                             │
│                                                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │  /projects  │  │  /workflows │  │    /jobs    │              │
│  └─────────────┘  └─────────────┘  └─────────────┘              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │   /nodes    │  │   /render   │  │  /webhooks  │              │
│  └─────────────┘  └─────────────┘  └─────────────┘              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       PROCESSING LAYER                           │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                    Redis + BullMQ                        │    │
│  │                                                          │    │
│  │   Queues:                                                │    │
│  │   - video-generation (parent jobs)                       │    │
│  │   - scenes (child jobs - parallelizable)                 │    │
│  │   - webhooks (delivery)                                  │    │
│  └─────────────────────────────────────────────────────────┘    │
│                              │                                   │
│                              ▼                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                      Workers                             │    │
│  │                                                          │    │
│  │   - Image Worker (Nano Banana, Flux, etc.)              │    │
│  │   - Video Worker (VEO, Kling, etc.)                     │    │
│  │   - Voice Worker (ElevenLabs, etc.)                     │    │
│  │   - Webhook Worker (delivery + retries)                 │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        DATA LAYER                                │
│                                                                  │
│  ┌──────────────────┐              ┌──────────────────┐         │
│  │    Supabase      │              │  Cloudflare R2   │         │
│  │   (PostgreSQL)   │              │    (Storage)     │         │
│  │                  │              │                  │         │
│  │  - Users         │              │  - Images        │         │
│  │  - Projects      │              │  - Videos        │         │
│  │  - Workflows     │              │  - Audio         │         │
│  │  - Jobs          │              │                  │         │
│  │  - Usage         │              │                  │         │
│  └──────────────────┘              └──────────────────┘         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    AI PROVIDER ABSTRACTION                       │
│                                                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │   Image     │  │    Video    │  │    Voice    │              │
│  │  Provider   │  │   Provider  │  │   Provider  │              │
│  │  Interface  │  │  Interface  │  │  Interface  │              │
│  └─────────────┘  └─────────────┘  └─────────────┘              │
│         │                │                │                      │
│         ▼                ▼                ▼                      │
│  ┌───────────┐    ┌───────────┐    ┌───────────┐                │
│  │NanoBanana │    │    VEO    │    │ElevenLabs │                │
│  │   Flux    │    │   Kling   │    │  PlayHT   │                │
│  │  DALL-E   │    │  Runway   │    │   Azure   │                │
│  └───────────┘    └───────────┘    └───────────┘                │
└─────────────────────────────────────────────────────────────────┘
```

---

## Database Schema

### Core Tables

```sql
-- Users (extends Supabase auth.users)
CREATE TABLE public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    full_name TEXT,
    avatar_url TEXT,
    tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'basic', 'pro', 'business', 'enterprise')),
    credits_balance INTEGER NOT NULL DEFAULT 50,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin', 'super_admin')),
    storage_used_bytes BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- API Keys
CREATE TABLE public.api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE, -- SHA256 hash of the key
    key_prefix TEXT NOT NULL, -- First 8 chars for identification (sn_live_abc12345...)
    last_used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Projects
CREATE TABLE public.projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    settings JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Folders (organize workflows within projects)
CREATE TABLE public.folders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Characters (per-project, for visual consistency across scenes)
CREATE TABLE public.characters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    reference_image_url TEXT,
    visual_traits JSONB NOT NULL DEFAULT '{}', -- { hair: "blonde", age: "young", clothing: "armor", etc. }
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Style Presets (system + user-created visual style templates)
CREATE TABLE public.style_presets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    thumbnail_url TEXT,
    settings JSONB NOT NULL DEFAULT '{}',     -- { aspectRatio, provider, model, negativePrompt, stylePrompt, etc. }
    is_system BOOLEAN NOT NULL DEFAULT FALSE, -- TRUE for built-in presets
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE, -- NULL for system presets
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Workflows (the node graph)
CREATE TABLE public.workflows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    folder_id UUID REFERENCES public.folders(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    description TEXT,
    source_prompt TEXT,                       -- Original prompt if workflow was auto-generated via "Build from Prompt"
    nodes JSONB NOT NULL DEFAULT '[]',        -- React Flow nodes
    edges JSONB NOT NULL DEFAULT '[]',        -- React Flow edges
    settings JSONB NOT NULL DEFAULT '{}',
    is_template BOOLEAN NOT NULL DEFAULT FALSE,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Workflow History (for undo/versioning)
CREATE TABLE public.workflow_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    nodes JSONB NOT NULL,
    edges JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Jobs (workflow executions)
CREATE TABLE public.jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    parent_job_id UUID REFERENCES public.jobs(id) ON DELETE CASCADE, -- For scene jobs
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'queued', 'processing', 'completed', 'failed', 'cancelled')),
    priority INTEGER NOT NULL DEFAULT 0, -- Higher = more priority
    progress INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
    credits_estimated INTEGER,
    credits_used INTEGER,
    input_data JSONB NOT NULL DEFAULT '{}',
    output_data JSONB,
    error_message TEXT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Job Checkpoints (for resuming failed jobs)
CREATE TABLE public.job_checkpoints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
    step TEXT NOT NULL,  -- 'script', 'images', 'video', 'audio', 'complete'
    data JSONB NOT NULL, -- Intermediate results
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Assets (generated files)
CREATE TABLE public.assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    job_id UUID REFERENCES public.jobs(id) ON DELETE SET NULL,
    type TEXT NOT NULL CHECK (type IN ('image', 'video', 'audio', 'document')),
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    r2_key TEXT NOT NULL,       -- Cloudflare R2 object key
    r2_url TEXT NOT NULL,       -- Public URL
    metadata JSONB DEFAULT '{}', -- dimensions, duration, etc.
    expires_at TIMESTAMPTZ,      -- Based on tier retention
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Webhooks
CREATE TABLE public.webhooks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    secret TEXT,                 -- For HMAC signature
    events TEXT[] NOT NULL DEFAULT ARRAY['job.completed', 'job.failed'],
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Webhook Deliveries (for retry tracking)
CREATE TABLE public.webhook_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    webhook_id UUID NOT NULL REFERENCES public.webhooks(id) ON DELETE CASCADE,
    job_id UUID REFERENCES public.jobs(id) ON DELETE SET NULL,
    event TEXT NOT NULL,
    payload JSONB NOT NULL,
    response_status INTEGER,
    response_body TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_retry_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Usage Logs (for billing)
CREATE TABLE public.usage_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    job_id UUID REFERENCES public.jobs(id) ON DELETE SET NULL,
    action TEXT NOT NULL,        -- 'image_generation', 'video_generation', etc.
    provider TEXT NOT NULL,      -- 'nano_banana', 'veo', 'elevenlabs'
    credits_used INTEGER NOT NULL,
    cost_usd DECIMAL(10, 6),     -- Our actual cost
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Subscriptions
CREATE TABLE public.subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    paddle_subscription_id TEXT UNIQUE,
    paddle_customer_id TEXT,
    tier TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'past_due', 'canceled', 'incomplete')),
    current_period_start TIMESTAMPTZ,
    current_period_end TIMESTAMPTZ,
    cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Credit Purchases (top-ups)
CREATE TABLE public.credit_purchases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    paddle_transaction_id TEXT UNIQUE,
    credits INTEGER NOT NULL,
    amount_usd DECIMAL(10, 2) NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'failed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Row Level Security

```sql
-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.characters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.style_presets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

-- Profiles: Users can only see/edit their own profile
CREATE POLICY "Users can view own profile" ON public.profiles
    FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.profiles
    FOR UPDATE USING (auth.uid() = id);

-- Projects: Users can only access their own projects
CREATE POLICY "Users can CRUD own projects" ON public.projects
    FOR ALL USING (auth.uid() = user_id);

-- Characters: Access via project ownership (user_id on project)
CREATE POLICY "Users can CRUD own characters" ON public.characters
    FOR ALL USING (
        EXISTS (SELECT 1 FROM public.projects WHERE id = project_id AND user_id = auth.uid())
    );

-- Style Presets: Users can read system presets + CRUD their own
CREATE POLICY "Users can read system presets" ON public.style_presets
    FOR SELECT USING (is_system = TRUE OR user_id = auth.uid());
CREATE POLICY "Users can CRUD own presets" ON public.style_presets
    FOR ALL USING (user_id = auth.uid());

-- Workflows: Users can only access their own workflows
CREATE POLICY "Users can CRUD own workflows" ON public.workflows
    FOR ALL USING (auth.uid() = user_id);

-- Jobs: Users can only access their own jobs
CREATE POLICY "Users can CRUD own jobs" ON public.jobs
    FOR ALL USING (auth.uid() = user_id);

-- Assets: Users can only access their own assets
CREATE POLICY "Users can CRUD own assets" ON public.assets
    FOR ALL USING (auth.uid() = user_id);

-- API Keys: Users can only manage their own keys
CREATE POLICY "Users can CRUD own API keys" ON public.api_keys
    FOR ALL USING (auth.uid() = user_id);

-- Webhooks: Users can only manage their own webhooks
CREATE POLICY "Users can CRUD own webhooks" ON public.webhooks
    FOR ALL USING (auth.uid() = user_id);

-- Usage logs: Users can only view their own usage
CREATE POLICY "Users can view own usage" ON public.usage_logs
    FOR SELECT USING (auth.uid() = user_id);

-- Subscriptions: Users can only view their own subscription
CREATE POLICY "Users can view own subscription" ON public.subscriptions
    FOR SELECT USING (auth.uid() = user_id);
```

### Indexes

```sql
-- Performance indexes
CREATE INDEX idx_projects_user_id ON public.projects(user_id);
CREATE INDEX idx_folders_project_id ON public.folders(project_id);
CREATE INDEX idx_characters_project_id ON public.characters(project_id);
CREATE INDEX idx_style_presets_user_id ON public.style_presets(user_id);
CREATE INDEX idx_style_presets_is_system ON public.style_presets(is_system) WHERE is_system = TRUE;
CREATE INDEX idx_workflows_project_id ON public.workflows(project_id);
CREATE INDEX idx_workflows_folder_id ON public.workflows(folder_id);
CREATE INDEX idx_workflows_user_id ON public.workflows(user_id);
CREATE INDEX idx_jobs_workflow_id ON public.jobs(workflow_id);
CREATE INDEX idx_jobs_user_id ON public.jobs(user_id);
CREATE INDEX idx_jobs_status ON public.jobs(status);
CREATE INDEX idx_jobs_parent_job_id ON public.jobs(parent_job_id);
CREATE INDEX idx_assets_user_id ON public.assets(user_id);
CREATE INDEX idx_assets_job_id ON public.assets(job_id);
CREATE INDEX idx_assets_expires_at ON public.assets(expires_at);
CREATE INDEX idx_usage_logs_user_id ON public.usage_logs(user_id);
CREATE INDEX idx_usage_logs_created_at ON public.usage_logs(created_at);
CREATE INDEX idx_api_keys_key_hash ON public.api_keys(key_hash);
CREATE INDEX idx_webhook_deliveries_next_retry ON public.webhook_deliveries(next_retry_at) WHERE delivered_at IS NULL;
```

---

## Node Types Specification

### How Nodes Connect

Nodes have **inputs** (left side) and **outputs** (right side). 

**Key principles:**
- One output can connect to **multiple** inputs (branching)
- Multiple outputs can connect to **one** input (merging)
- Output of one node can serve as **reference** for another (chaining)
- Same node can output to **different formats** (e.g., TikTok + YouTube)

```
Example: Image node output → connects to both Video node AND next Image node as reference

    ┌─────────────┐
    │ 🎨 Image 1  │─────┬────▶ [🎬 Video 1]
    │   Output    │     │
    └─────────────┘     │
                        └────▶ [🎨 Image 2 as Reference Input]
```

### Node Configuration Principles

#### 1. Model Selection Per Node

**Every AI node allows the user to select which provider/model to use.**

```
┌─────────────────────────────────────────┐
│ 🎨 Generate Image - Scene 3             │
│                                         │
│ Provider: [Nano Banana ▼]               │
│           ├─ Nano Banana (recommended)  │
│           ├─ Flux                       │
│           ├─ DALL-E                     │
│           └─ Midjourney API             │
│                                         │
│ Model: [gemini-2.5-flash-image ▼]       │
└─────────────────────────────────────────┘
```

**Use cases:**
- Scene 1-4: Nano Banana (character consistency)
- Scene 5 (dream sequence): Flux (intentionally different style)
- Scene 6-8: Nano Banana (back to reality)

#### 2. Editable Prompts Per Node

**Every node that uses prompts allows:**
- Auto-generated prompt from Script Generator
- Manual editing of the prompt
- Writing prompt from scratch

```
┌─────────────────────────────────────────┐
│ 🎨 Generate Image - Scene 3             │
│                                         │
│ Prompt Mode: [Auto-generated ▼] [✏️]    │
│              ├─ Auto-generated          │
│              └─ Manual                  │
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │ The knight stands before the       │ │
│ │ dragon, sword raised, flames       │ │
│ │ reflecting in his armor...         │ │
│ │                                    │ │
│ │ [Edit] [Reset to Auto]             │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ ☑️ Pass to next scene as reference     │
└─────────────────────────────────────────┘
```

#### 3. Default Providers (Can Always Change)

| Node Type | Default Provider | Alternatives |
|-----------|------------------|--------------|
| Generate Image | Nano Banana | Flux, DALL-E, Midjourney |
| Image to Video | MiniMax | VEO, VEO 3, Kling, Runway, Pika |
| Text to Speech | ElevenLabs | PlayHT, Azure TTS |
| Generate Script | Claude | GPT-4, Gemini |

#### 4. Parameter Nodes

**Every field on every AI node has TWO ways to set its value:**
1. **Config Panel Field (default)** - dropdown/input in the Node Settings panel
2. **Parameter Node (optional)** - a separate node on canvas that connects and overrides the config value

**Resolution rule:**
- If a Parameter Node is connected to a field → use the connected value
- If no connection → use the Config Panel value (fallback)

**Benefits:**
- **Write once, connect many**: Define duration once, connect to every Image to Video node
- **Dynamic parameters from n8n**: Pass `duration`, `style`, `provider` as workflow variables from API/n8n
- **Visual clarity**: See at a glance where each value comes from on the canvas

##### Provider Nodes (4 types, one per AI category)

| Node | Type | Values | Output Handle | Connects To |
|------|------|--------|---------------|-------------|
| ImageProviderNode | `image-provider` | nano-banana, flux, dalle, midjourney | `image_provider` | Generate Image |
| VideoProviderNode | `video-provider` | minimax, veo, veo3, kling, runway, pika | `video_provider` | Image to Video, Video to Video |
| VoiceProviderNode | `voice-provider` | elevenlabs, playht, azure | `voice_provider` | Text to Speech |
| ScriptProviderNode | `script-provider` | claude, gpt, gemini | `script_provider` | Generate Script |

##### Value Nodes

| Node | Type | Data | Output Handle | Connects To |
|------|------|------|---------------|-------------|
| DurationNode | `duration` | seconds: number | `duration` | Image to Video, Generate Script |
| AspectRatioNode | `aspect-ratio` | ratio: enum | `aspect_ratio` | Generate Image |
| MotionNode | `motion` | motion: subtle/moderate/dynamic | `motion` | Image to Video |
| CameraMotionNode | `camera-motion` | camera: static/pan-left/pan-right/zoom-in/zoom-out | `camera_motion` | Image to Video |
| VoiceNode | `voice` | voiceId, voiceName, gender, tone | `voice` | Text to Speech |

##### Generic TextNode

| Node | Type | Data | Output Handle | Connects To |
|------|------|------|---------------|-------------|
| TextNode | `text` | label: string, text: string | `text` | Any text input (tone, style_guide, negative_prompt, scene dialogue, etc.) |

User sets the label to describe what this text is for. Same node type, different uses.

##### VoiceNode - Predefined Voices

For MVP/Cloud, hardcoded voice list:
- Maria (Female, Bright)
- Oliver (Male, Upbeat)
- James (Male, Informative)
- Maya (Female, Firm)
- Leo (Male, Excitable)
- Sophie (Female, Youthful)
- Gabriel (Male, Easy-going)
- Alex (Male, Smooth)

For Self-Hosted: same list + option to import from ElevenLabs API.

##### NOT Parameter Nodes (Config Panel Only)

These fields are only available in the config panel, not as Parameter Nodes:

| Field | Why Not Parameter Node |
|-------|------------------------|
| model | Depends on provider selection, dropdown in config |
| characterIds | Selection from project's character list, checkboxes in config |
| stylePresetId | Selection from preset library, dropdown in config |

##### Receiving Nodes and Their Parameter Input Handles

| Node | Parameter Input Handles |
|------|------------------------|
| Generate Script | `script_provider`, `duration`, `text` (for tone, style_guide) |
| Generate Image | `image_provider`, `aspect_ratio`, `text` (for style_guide, negative_prompt) |
| Image to Video | `video_provider`, `duration`, `motion`, `camera_motion` |
| Text to Speech | `voice_provider`, `voice` |
| Combine Videos | (none - simple processing) |

### Input Nodes

```typescript
interface TextPromptNode {
  type: 'text-prompt';
  data: {
    text: string;
    variables?: Record<string, string>; // Template variables
  };
}

interface UploadImageNode {
  type: 'upload-image';
  data: {
    assetId?: string;        // Reference to uploaded asset
    url?: string;            // Or external URL
  };
}

interface UploadVideoNode {
  type: 'upload-video';
  data: {
    assetId?: string;
    url?: string;
  };
}

interface RSSFeedNode {
  type: 'rss-feed';
  data: {
    feedUrl: string;
    itemIndex?: number;      // Which item to use (0 = latest)
    extractFields: string[]; // ['title', 'description', 'image']
  };
}

// --- Parameter Nodes ---
// Parameter Nodes override config panel values when connected.
// Resolution: connected value wins, otherwise config panel fallback.

// Provider Nodes (one per AI category)
interface ImageProviderNode {
  type: 'image-provider';
  data: {
    provider: 'nano-banana' | 'flux' | 'dalle' | 'midjourney';
  };
  inputs: [];
  outputs: ['image_provider'];
  creditCost: 0;
}

interface VideoProviderNode {
  type: 'video-provider';
  data: {
    provider: 'minimax' | 'veo' | 'veo3' | 'kling' | 'runway' | 'pika';
  };
  inputs: [];
  outputs: ['video_provider'];
  creditCost: 0;
}

interface VoiceProviderNode {
  type: 'voice-provider';
  data: {
    provider: 'elevenlabs' | 'playht' | 'azure';
  };
  inputs: [];
  outputs: ['voice_provider'];
  creditCost: 0;
}

interface ScriptProviderNode {
  type: 'script-provider';
  data: {
    provider: 'claude' | 'gpt' | 'gemini';
  };
  inputs: [];
  outputs: ['script_provider'];
  creditCost: 0;
}

// Value Nodes
interface DurationNode {
  type: 'duration';
  data: {
    seconds: number;         // Target duration in seconds
  };
  inputs: [];
  outputs: ['duration'];
  creditCost: 0;
}

interface AspectRatioNode {
  type: 'aspect-ratio';
  data: {
    ratio: '1:1' | '16:9' | '9:16' | '4:3' | '4:5';
  };
  inputs: [];
  outputs: ['aspect_ratio'];
  creditCost: 0;
}

interface MotionNode {
  type: 'motion';
  data: {
    motion: 'subtle' | 'moderate' | 'dynamic';
  };
  inputs: [];
  outputs: ['motion'];
  creditCost: 0;
}

interface CameraMotionNode {
  type: 'camera-motion';
  data: {
    camera: 'static' | 'pan-left' | 'pan-right' | 'zoom-in' | 'zoom-out';
  };
  inputs: [];
  outputs: ['camera_motion'];
  creditCost: 0;
}

interface VoiceNode {
  type: 'voice';
  data: {
    voiceId: string;
    voiceName: string;       // e.g. "Maria", "Oliver"
    gender: 'male' | 'female';
    tone: string;            // e.g. "Bright", "Upbeat", "Informative"
  };
  inputs: [];
  outputs: ['voice'];
  creditCost: 0;
  // Predefined voices (MVP):
  // Maria (Female, Bright), Oliver (Male, Upbeat), James (Male, Informative),
  // Maya (Female, Firm), Leo (Male, Excitable), Sophie (Female, Youthful),
  // Gabriel (Male, Easy-going), Alex (Male, Smooth)
}

// Generic Text Node - user sets label to describe purpose
interface TextNode {
  type: 'text';
  data: {
    label: string;           // e.g. "Tone", "Style Guide", "Negative Prompt"
    text: string;            // The actual text value
  };
  inputs: [];
  outputs: ['text'];         // Connects to any text input handle
  creditCost: 0;
}
```

### AI Nodes

```typescript
interface GenerateScriptNode {
  type: 'generate-script';
  data: {
    provider: 'claude' | 'gpt' | 'gemini';
    model?: string;
    systemPrompt?: string;
    structure?: 'freeform' | '8-step' | 'custom';
    sceneCount?: number;
    tone?: string;
    targetLength?: number;   // seconds
    stylePresetId?: string;  // Optional style preset to guide visual descriptions
  };
  inputs: ['prompt'];
  // Parameter input handles (optional, override config panel values when connected):
  parameterInputs: ['script_provider', 'duration', 'text'];  // text for tone, style_guide
  outputs: ['script', 'scenes'];
  creditCost: 2;

  // Enhanced Prompt Generation:
  // The Generate Script node produces CINEMATIC scripts, not just structured briefs.
  // Each scene description includes:
  // - Camera movement and framing (close-up, wide shot, tracking)
  // - Pacing and rhythm (fast cuts, slow reveal, beat)
  // - Sensory details (lighting, atmosphere, textures, colors)
  // - Scale and environment (intimate room, vast landscape, crowd)
  // - Character action and emotion (not just "character walks" but HOW they walk)
  // - Transition suggestions between scenes
  //
  // Example output per scene:
  // "WIDE SHOT - A lone knight stands at the edge of a crumbling stone bridge.
  //  Golden hour light cuts through mist rising from the chasm below.
  //  His armor catches the light as he grips his sword, knuckles white.
  //  Camera slowly PUSHES IN as wind whips his tattered cloak.
  //  The scale of the canyon dwarfs him - we feel his isolation."
}

interface GenerateImageNode {
  type: 'generate-image';
  data: {
    provider: 'nano-banana' | 'flux' | 'dalle';
    model?: string;
    style?: string;
    aspectRatio?: '1:1' | '16:9' | '9:16' | '4:3';
    negativePrompt?: string;
    characterIds?: string[];   // Project characters to include in this image
    stylePresetId?: string;    // Style preset to apply
  };
  inputs: ['prompt', 'reference?'];  // Reference accepts MULTIPLE connections
  // Parameter input handles (optional, override config panel values when connected):
  parameterInputs: ['image_provider', 'aspect_ratio', 'text'];  // text for style_guide, negative_prompt
  outputs: ['image'];                // Output can connect to MULTIPLE nodes
  creditCost: 5;

  // Reference input can receive:
  // - Uploaded images (for character consistency)
  // - Output from previous Generate Image node (for chaining)
  // - Multiple images at once (Nano Banana supports up to 14)

  // Character Consistency:
  // When characterIds are set, the node automatically:
  // 1. Loads character data (name, description, visual_traits, reference_image_url) from the project
  // 2. Appends character descriptions to the image prompt
  //    e.g. "Include character 'Sir Aldric': tall male knight, blonde hair, steel plate armor, blue cape, scar on left cheek"
  // 3. Passes character reference images as additional reference inputs to the provider
  // 4. This ensures the same character looks consistent across all scenes
  //
  // Characters are defined at the PROJECT level (not per workflow), so they
  // can be reused across multiple workflows within the same project.
  //
  // UI: The node config panel shows a "Characters" section with checkboxes
  // for each project character. Selecting a character adds their visual traits
  // and reference image to the generation request.
}

interface ImageToVideoNode {
  type: 'image-to-video';
  data: {
    provider: 'minimax' | 'veo' | 'veo3' | 'veo3.1' | 'kling' | 'runway' | 'pika';
    model?: string;
    duration?: number;       // seconds (veo3.1 restricted to 4, 6, or 8)
    motion?: 'subtle' | 'moderate' | 'dynamic';
    cameraMotion?: 'static' | 'pan-left' | 'pan-right' | 'zoom-in' | 'zoom-out';
    generateAudio?: boolean; // VEO 3/3.1 only: generate AI audio from prompt
    // Internal selection state (for single input handle with dropdowns):
    selectedStartFrameNodeId?: string;  // Required - which connected image node to use as start frame
    selectedEndFrameNodeId?: string;    // Optional - which connected image node to use as end frame
    selectedAudioNodeId?: string;       // Optional - which connected audio node to use
  };
  inputs: ['input'];         // SINGLE input handle accepts images AND audio connections
  // Parameter input handles (optional, override config panel values when connected):
  parameterInputs: ['video_provider', 'duration', 'motion', 'camera_motion'];
  outputs: ['video'];        // Note: VEO 3/3.1 can output video WITH AI-generated audio
  creditCost: 20;

  // SINGLE INPUT HANDLE WITH INTERNAL DROPDOWNS:
  // The node has ONE "input" handle that accepts multiple connection types:
  // - Image nodes (generate-image, upload-image, character, object, location, scene)
  // - Audio nodes (text-to-speech, generate-music, text-to-audio, upload-audio)
  //
  // Inside the node, dropdown selectors let users choose:
  // 1. Start Frame (required) - selects from connected image nodes
  //    - Shows thumbnail preview + node label
  //    - Auto-selects first connected image node
  // 2. End Frame (optional) - selects from connected image nodes
  //    - Only shown for providers that support it: veo3.1, kling, runway, pika
  //    - NOTE: veo3 does NOT support end frame, only veo3.1 does
  //    - Hidden for minimax, veo, veo3 (they don't support end frames)
  // 3. Audio Track (optional) - selects from connected audio nodes
  //    - Audio is merged with video after generation (via FFmpeg)
  //
  // This design simplifies canvas connections (one handle vs many) while
  // providing clear selection UI inside the node config panel.

  // VEO 3.1 SPECIFICS:
  // - Supports first+last frame interpolation (image + last_frame parameters)
  // - Duration restricted to 4, 6, or 8 seconds (UI shows dropdown, not free input)
  // - Does NOT support video-to-video (only image input, not video input)
  // - Replicate API parameters: image (not first_frame), last_frame, duration, aspect_ratio
  //
  // VEO 3 DIFFERENCES:
  // - Does NOT support end frame (first+last frame interpolation)
  // - No duration restrictions (free input field)

  // VEO 3/3.1 AUDIO:
  // VEO 3/3.1 has a `generate_audio` toggle (default: true when VEO 3/3.1 selected).
  // When enabled, VEO generates AI audio from the prompt (ambient sounds, etc.).
  // VEO does NOT accept external audio files - it only generates audio from prompt.
  // If user wants custom audio instead:
  // 1. Disable generate_audio on the Image to Video node
  // 2. Use Merge Video & Audio node to combine with custom audio
  // For mixing VEO audio with custom audio:
  // 1. Keep generate_audio enabled
  // 2. Use Extract Audio node to separate VEO audio
  // 3. Adjust volume, mix with custom audio
  // 4. Merge back with silent video
}

interface TextToSpeechNode {
  type: 'text-to-speech';
  data: {
    provider: 'elevenlabs' | 'playht' | 'azure';
    voiceId: string;
    language?: string;
    speed?: number;
    pitch?: number;
  };
  inputs: ['text'];
  // Parameter input handles (optional, override config panel values when connected):
  parameterInputs: ['voice_provider', 'voice'];
  outputs: ['audio'];
  creditCost: 3;

  // ElevenLabs is ALWAYS available as an option.
  // Even if video was generated with VEO audio, user can:
  // 1. Extract/mute VEO audio
  // 2. Generate new voiceover with ElevenLabs
  // 3. Mix both or use only ElevenLabs
}

interface GenerateMusicNode {
  type: 'generate-music';
  data: {
    provider: 'musicgen' | 'minimax' | 'lyria' | 'bark';
    genre?: string;
    mood?: string;
    instrumental?: boolean;
    lyrics?: string;
    duration?: number;
  };
  inputs: ['prompt', 'reference-audio?'];
  outputs: ['audio'];
  creditCost: 3;
}

interface TextToAudioNode {
  type: 'text-to-audio';
  data: {
    provider: 'tangoflux' | 'tango' | 'audioldm' | 'bark';
    duration?: number;       // seconds
  };
  inputs: ['prompt'];
  outputs: ['audio'];
  creditCost: 3;

  // Sound effects generation from text descriptions.
  // Use cases: ambient sounds, SFX, background audio.
  // Provider notes:
  // - TangoFlux (default): best quality, supports duration
  // - Tango: good quality, no duration control
  // - AudioLDM: supports duration as string enum ("2.5", "5.0", etc.), prompt max 200 chars
  // - Bark: general audio, no duration control
}

interface QACheckNode {
  type: 'qa-check';
  data: {
    provider: 'claude' | 'gpt';
    checkType: 'content' | 'quality' | 'consistency' | 'safety';
    threshold?: number;      // 0-1, auto-approve above this
    criteria?: string[];
  };
  inputs: ['content'];
  outputs: ['approved', 'rejected', 'feedback'];
  creditCost: 1;
}
```

### Processing Nodes

```typescript
interface CombineVideosNode {
  type: 'combine-videos';
  data: {
    transition?: 'cut' | 'fade' | 'dissolve';
    transitionDuration?: number;
  };
  inputs: ['videos[]'];  // Accepts UNLIMITED video connections
  outputs: ['video'];
  creditCost: 2;
  
  // Can merge videos from multiple branches back into one
}

interface MergeVideoAudioNode {
  type: 'merge-video-audio';
  data: {
    voiceoverVolume?: number;
    backgroundVolume?: number;
    keepOriginalAudio?: boolean;
  };
  inputs: ['video', 'audio'];
  outputs: ['video'];
  creditCost: 1;
}

interface AddCaptionsNode {
  type: 'add-captions';
  data: {
    style: 'subtitle' | 'word-highlight' | 'karaoke';
    position: 'bottom' | 'top' | 'center';
    fontFamily?: string;
    fontSize?: number;
    color?: string;
    backgroundColor?: string;
  };
  inputs: ['video', 'transcript?'];
  outputs: ['video'];
  creditCost: 2;
}

interface ResizeVideoNode {
  type: 'resize-video';
  data: {
    targetAspect: '1:1' | '16:9' | '9:16' | '4:5';
    method: 'crop' | 'pad' | 'stretch';
    padColor?: string;
  };
  inputs: ['video'];
  outputs: ['video'];
  creditCost: 1;
}

interface ExtractAudioNode {
  type: 'extract-audio';
  data: {
    outputSilentVideo: boolean;  // Also output video without audio
    audioFormat?: 'mp3' | 'wav' | 'aac';
  };
  inputs: ['video'];
  outputs: ['audio', 'silent-video?'];  // Can output both
  creditCost: 1;
  
  // Use case: VEO 3 generates video WITH audio, but you want to:
  // 1. Extract the audio (ambient sounds)
  // 2. Lower its volume
  // 3. Add ElevenLabs voiceover on top
}

interface MixAudioNode {
  type: 'mix-audio';
  data: {
    tracks: Array<{
      volume: number;        // 0-100 (percentage)
      startTime?: number;    // Offset in seconds
      fadeIn?: number;       // Fade in duration
      fadeOut?: number;      // Fade out duration
      loop?: boolean;        // Loop if shorter than video
    }>;
  };
  inputs: ['audio[]'];       // Accepts MULTIPLE audio inputs
  outputs: ['audio'];
  creditCost: 1;
  
  // Example: Mix VEO ambient (20%) + ElevenLabs voice (100%)
}

interface AdjustVolumeNode {
  type: 'adjust-volume';
  data: {
    volume: number;          // 0-200 (percentage, >100 = amplify)
    normalize?: boolean;     // Auto-normalize levels
    fadeIn?: number;
    fadeOut?: number;
  };
  inputs: ['audio'];
  outputs: ['audio'];
  creditCost: 0;  // Simple processing, no AI
}

interface TrimVideoNode {
  type: 'trim-video';
  data: {
    startTime: number;       // Seconds
    endTime?: number;        // Seconds (optional, defaults to end)
    duration?: number;       // Alternative: specify duration instead of endTime
  };
  inputs: ['video'];
  outputs: ['video'];
  creditCost: 0;  // Simple processing, no AI
}
```

### Audio Processing Example Flow

```
VEO 3 video with ambient audio → Extract → Mix with ElevenLabs → Final video

┌─────────────┐
│ 🎬 VEO 3    │
│ Video+Audio │
└──────┬──────┘
       │
       ▼
┌─────────────────┐
│ 🔇 Extract      │
│    Audio        │
├─────────────────┤
│ Outputs:        │
│ • Silent video ─┼────────────────────────────┐
│ • VEO audio   ──┼───┐                        │
└─────────────────┘   │                        │
                      ▼                        │
               ┌─────────────┐                 │
               │ 🔊 Adjust   │                 │
               │ Volume: 20% │                 │
               └──────┬──────┘                 │
                      │                        │
┌─────────────┐       │                        │
│ 🎤 Eleven   │       │                        │
│   Labs      │       │                        │
│ (100% vol)  │       │                        │
└──────┬──────┘       │                        │
       │              │                        │
       └──────┬───────┘                        │
              ▼                                │
       ┌─────────────┐                         │
       │ 🔀 Mix      │                         │
       │   Audio     │                         │
       │             │                         │
       │ Track 1: 20%│                         │
       │ Track 2:100%│                         │
       └──────┬──────┘                         │
              │                                │
              └────────────┬───────────────────┘
                           ▼
                    ┌─────────────┐
                    │ 🔗 Add      │
                    │   Audio     │
                    │ to Video    │
                    └──────┬──────┘
                           │
                           ▼
                       💾 Save
```

### Output Nodes

```typescript
interface SaveToStorageNode {
  type: 'save-to-storage';
  data: {
    filename?: string;       // Template: {{project_name}}_{{timestamp}}
    format?: 'mp4' | 'webm' | 'mov';
    quality?: 'draft' | 'standard' | 'high' | '4k';
  };
  inputs: ['video'];
  outputs: ['asset'];
  creditCost: 0;
}

interface WebhookOutputNode {
  type: 'webhook-output';
  data: {
    webhookId: string;
    includeAssetUrl: boolean;
    customPayload?: Record<string, any>;
  };
  inputs: ['data'];
  outputs: [];
  creditCost: 0;
}
```

### Utility Nodes

#### Sticky Note Node

A canvas-level organizational node for adding notes, documentation, and visual grouping to workflows. Sticky notes stay behind all other nodes for non-intrusive annotation.

**Category:** `utility` (yellow/amber)
**Type:** `sticky-note`
**Credit Cost:** 0 (non-executable, canvas-only)
**Implementation:** `frontend/src/components/nodes/sticky-note-node.tsx`

**Features:**
- **Always Editable:** Textarea is always visible and editable (no double-click mode)
- **Background Color Picker:** Large 40x40px color picker with "BG" label
- **Text Color Picker:** Large 40x40px color picker with "Text" label
- **Font Size Control:** Dropdown with Small, Normal, Large, X-Large options
- **Bold/Italic:** Toggle buttons with visual active state
- **Text Alignment:** Left, Center, Right alignment buttons
- **Insert Link:** Prompts for URL and text, inserts markdown `[text](url)`
- **Insert Image:** Prompts for image URL, inserts markdown `![alt](url)`
- **Insert Table:** Inserts 3-column markdown table template
- **Insert Bullet List:** Inserts 3-item bullet list template
- **Resizable:** Drag corners/edges via NodeResizer (min 280x120)
- **Adaptive Border:** Border auto-adjusts to contrast with background color
- **Always Behind:** CSS forces z-index -1 even during drag/selection

**Toolbar:** Appears inside the note at top when selected. Contains:
- Colors group: BG color picker + Text color picker (with labels)
- Format group: Font size dropdown + Bold + Italic buttons
- Alignment group: Left, Center, Right buttons
- Insert group: Link, Image, Table, Bullet list buttons

**Default Values:**
- Text: "I'm a note\nDouble click to customize"
- Background: `#2d2d44` (dark purple/gray)
- Text color: `#ffffff` (white)
- Size: 280x180 pixels

**How to Add:**
1. Right-click on canvas -> "Add Sticky Note"
2. Or press Shift+S anywhere on canvas

**How to Edit:**
- Click on the note and start typing (always editable)
- Use toolbar buttons to format text
- Insert tools add content at cursor position

**Data Type:**
```typescript
interface StickyNoteData {
  label: string
  text: string                              // Plain text content
  color: string                             // Background hex color (e.g., "#2d2d44")
  textColor: string                         // Text hex color (e.g., "#ffffff")
  width: number                             // Default: 280
  height: number                            // Default: 180
  fontSize: "sm" | "base" | "lg" | "xl"     // Default: "base"
  bold: boolean                             // Default: false
  italic: boolean                           // Default: false
  alignment: "left" | "center" | "right"    // Default: "left"
}
```

**Use Cases:**
- Group related nodes with visual sections
- Add explanations or documentation to workflow areas
- Annotate complex node chains
- Leave TODO notes or reminders
- Insert markdown tables for structured data
- Add links to external resources

**CSS Implementation (globals.css):**
```css
.react-flow__node-sticky-note {
  z-index: -1 !important;
}
.react-flow__node-sticky-note.dragging {
  z-index: -1 !important;
}
.react-flow__node-sticky-note.selected {
  z-index: -1 !important;
}
```

### Scene Node (Cinematic Control Center)

The Scene Node is a rich data node that combines characters, locations, objects, cinematography, mood, and dialogue into a structured scene definition. It outputs a smart prompt to connected Generate Image / Image to Video nodes.

**Category:** `scene` (purple/violet)
**Icon:** Clapperboard
**Credit Cost:** 0 (data-only, not executable by itself)
**Implementation:** `frontend/src/components/nodes/scene-node.tsx`

#### Input Handles

| Handle | Position | Description |
|--------|----------|-------------|
| `in` | Left (top) | Optional input from upstream nodes |
| `audio1` | Left (25%) | Audio input from TTS/audio nodes |
| `audio2` | Left (37%) | Audio input from TTS/audio nodes |
| `audio3` | Left (49%) | Audio input from TTS/audio nodes |
| `audio4` | Left (61%) | Audio input from TTS/audio nodes |
| `audio5` | Left (73%) | Audio input from TTS/audio nodes |

#### Output Handles

| Handle | Position | Description |
|--------|----------|-------------|
| `prompt` | Right (15%) | Generated text prompt from all scene parameters |
| `imageRefs` | Right (30%) | Reference image URLs from characters/locations |
| `narration` | Right (55%) | Narration text for TTS nodes |
| `dialogue` | Right (70%) | Dialogue lines for subtitle/caption nodes |
| `duration` | Right (85%) | Scene duration in seconds |

#### Audio Assignments (Connected Audio)

Scene Nodes accept up to 5 audio connections from Text to Speech, Generate Music, Text to Audio, or other audio-producing nodes. Each connected audio can be assigned to a specific dialogue line via the "Connected Audio" section in Step 3 (Audio).

**Data model:** `audioAssignments: AudioAssignment[]` on `SceneNodeDataType`. Each `AudioAssignment` has `handleId`, `sourceNodeId`, `dialogueIndex`, and `role` ("dialogue" | "narration" | "background" | "sfx").

**Priority:** Connected audio (via handles) takes priority over per-line generated audio (via Generate button). A "Connected" badge appears on dialogue lines that have assigned audio. Users can disconnect the edge to revert to generated audio.

#### Scene Editor Modal (Full-Screen Wizard)

Opened via the Expand button on the node. Two-panel layout with a 4-step wizard:
- **Left panel:** Generated image preview with version history, full-size preview, extract references, delete. Prompt preview with character count indicator.
- **Right panel:** Wizard stepper with 4 steps, each showing filtered `SceneConfig` sections.

**Wizard Steps:**

| Step | Label | Icon | Sections | Action Button |
|------|-------|------|----------|---------------|
| 1 | Story | BookOpen | Basic Info, Dialogue | -- |
| 2 | Image | Palette | Characters, Locations, Objects, Cinematography, Mood & Style | Generate Scene Image |
| 3 | Audio | Mic | Dialogue (with voice/generate), Audio settings | Generate All Audio |
| 4 | Video | Video | Video Provider, Duration, Transitions, Director Notes | Generate Video |

Step indicators show completion state (checkmark when complete). Navigation via Previous/Next buttons.

**Generate All Audio:** Iterates all dialogue lines without audio, generates TTS sequentially with progress display ("Generating 2/5..."). Uses `textToSpeech()` API + `getJobStatus()` polling.

**Generate Video (Step 4):** Takes the scene's generated image and sends it to the Image to Video API with the selected video provider, duration, and a video-optimized prompt built by `buildVideoPrompt()`. Polls `getJobStatus()` every 2s. On completion, appends to `generatedVideoResults` with version history. Video player with controls appears in the left panel via an Image/Video tab toggle. Supports version history (thumbnails, delete, switch active). Disabled when no image exists.

**Implementation:** `frontend/src/components/editor/scene-editor-modal.tsx`

#### Configuration Sections (`scene-config.tsx`)

`SceneConfig` accepts an optional `step` prop (1-4) to filter which sections render. When `step` is omitted (e.g. in the node's inline config panel), all sections show. The `showStep(s)` helper controls visibility: `const showStep = (s: number) => !step || step === s`.

**Step 1 (Story):**
- **Script Connection** (always visible, outside step filter): Link to Generate Script node, select scene, preview, import, auto-sync
- **Basic Info** (always open): Scene name, scene number, summary textarea
- **Dialogue**: Per-character dialogue lines with speaker dropdown, emotion tag, text area, add/remove lines

**Step 2 (Image):**
- **Characters**: Add from workflow assets dropdown (always shows "Create new character..." option), per-character mood/action/position fields, import from Manage Characters modal, quick add by description
- **Locations**: Add from workflow assets dropdown with "Create new location..." option, per-location time of day/weather/lighting overrides, primary location toggle, import and quick add support
- **Objects**: Add from workflow assets dropdown with "Create new object..." option, per-object description, import and quick add support
- **Cinematography**: Shot type, camera angle, camera movement, depth of field, lens type, aspect ratio
- **Mood & Style**: Mood tags (multi-select), color palette tags, visual style dropdown

**Step 3 (Audio):**
- **Dialogue**: Per-character dialogue lines with emotion tags, voice selection dropdown (26 ElevenLabs voices from `tts-voices.ts`), per-line Generate/New Version button, audio version history strip, inline audio player
- **Audio settings**: Narration textarea, music mood, sound effects tags

**Step 4 (Video):**
- **Video Provider**: Select dropdown (minimax, veo, veo3, kling, runway, pika)
- **Duration**: Duration input (1-60s)
- **Transitions**: Transition in/out dropdowns (cut, fade, dissolve, wipe, etc.)
- **Director Notes**: Textarea for free-form direction

**Prompt Preview:** In scene-config.tsx, only shown when not in wizard mode (`{!step && ...}`). The modal uses a Radix UI Accordion in the left panel showing "Generated Prompt (N/2000)" as a collapsible section with full untruncated text via `buildScenePrompt(data, assets, { forDisplay: true })`.

#### Dialogue Audio Generation

Each dialogue line supports per-line TTS audio generation with version history:

- **Voice dropdown**: 26 ElevenLabs voices via `TTS_VOICES` from `frontend/src/lib/tts-voices.ts`, default "Auto (Rachel)"
- **Generate button**: Calls `textToSpeech(text, voiceId)` from `frontend/src/lib/api.ts`, polls `getJobStatus()` every 2s
- **Version history**: Each generation appends a `DialogueAudioResult` to `generatedAudioResults` array (not replacing previous). Each result stores `url`, `jobId`, `voiceId`, `createdAt`.
- **Version strip UI**: Pill buttons showing `{voiceId} #{n}`, active version highlighted in violet, hover-reveal delete button per version
- **Active selection**: Click a version pill to switch the active audio player
- **Delete**: Hover a version pill to reveal X button, removes that version and adjusts `activeAudioIndex`
- **"New Version" button**: When results exist, the Generate button label changes to "New Version"

**Implementation:** `frontend/src/components/editor/scene-config.tsx`

#### Smart Prompt Builder (`prompt-builder.ts`)

Pure function that converts all scene parameters into an optimized image generation prompt.

**Priority tiers for length management:**
- **High** (always kept): Shot type + camera angle, character descriptions (truncated), location descriptions
- **Medium** (dropped second): Aspect ratio hint, objects, mood, visual style, camera movement, summary
- **Low** (dropped first): Depth of field, lens type, color palette, dialogue context, director notes

**Truncation strategy:**
1. Target safe length: 1800 characters
2. Drop low-priority parts one by one from the end
3. Drop medium-priority parts one by one from the end
4. Hard truncation at 2000 characters as safety net

**Display mode:** `buildScenePrompt(data, assets, { forDisplay: true })` skips all truncation and progressive dropping, returning the full untruncated prompt for UI display. The truncated version is used for API calls and character count, while the display version shows in the accordion.

**Character count display:** Both scene-config.tsx and scene-editor-modal.tsx show `{length}/{PROMPT_MAX_LENGTH}` with color coding:
- Green: under 90% of limit
- Amber: 90-100% of limit
- Red: over limit

**Implementation:** `frontend/src/lib/prompt-builder.ts`

#### Asset Integration

All three entity sections (Characters, Locations, Objects) support:
- **Dropdown selection** from existing workflow assets (filtered by category)
- **"Create new..." option** in dropdown that auto-expands the inline quick-add form
- **Import from Manage Characters modal** for bulk asset management
- **Quick add by description** - inline form that creates a new asset with name + description

#### Generate Scene Image

The Scene Node supports image generation via the Run button (hover tab). When run, it uses `runSingleNode` which sends the generated prompt to the configured image provider. Results appear in the node with version history thumbnails.

#### Extract References

From generated images, users can extract character/object references via the Scissors button. Opens `ExtractReferencesModal` which allows cropping regions and saving them as new `CharacterDefinition` assets for reuse across scenes.

#### Script Connection (Scene inherits from Generate Script)

Scene Nodes can link to a Generate Script node and import scene data (characters, dialogue, locations, cinematography, mood, images, prompts) from a specific scene in the generated script.

**Fields on SceneNodeDataType:**
- `sourceScriptNodeId: string` - ID of the linked Generate Script node (empty = not linked)
- `sourceSceneIndex: number` - Index of the scene within the script (-1 = none selected)
- `autoSyncWithScript: boolean` - When true, changing scene index auto-imports data

**UI (in SceneConfig, always visible when script nodes with results exist):**
- **Script dropdown**: Shows generated script titles (not node labels), resolves active result from `generatedResults[activeResultIndex].script ?? generatedScript`
- **Scene dropdown**: Shows scene names from the linked script (e.g. "1. The Awakening")
- **Scene preview**: Shows `visualDescription` snippet when a scene is selected
- **Import Now button**: Triggers `mapScriptSceneToNodeData()` to copy all fields
- **Auto-sync checkbox**: When enabled, importing happens automatically on scene change
- **Unlink button**: Clears link and resets fields
- **Import feedback**: Green bar showing what was imported (e.g. "Imported 3. The Battle -- 2 characters -- 3 dialogue lines")

**Field mapping (`mapScriptSceneToNodeData` in `types/nodes.ts`):**

| Script Scene Field | Scene Node Field |
|-------------------|-----------------|
| `sceneName` | `sceneName` |
| `visualDescription` | `summary` |
| `duration` / `durationHint` | `duration` |
| `mood` (array or string) | `mood` (normalized to array) |
| `musicMood` | `musicMood` |
| `soundEffects` | `soundEffects` |
| `characters` (string[] or ScriptSceneCharacter[]) | `characters` (mapped to SceneCharacterEntry[]) |
| `dialogue` (ScriptSceneDialogue[]) | `dialogue` (mapped to SceneDialogueEntry[]) |
| `location` (ScriptSceneLocation) | `locations` (single SceneLocationEntry) |
| `cinematography.shotType/cameraAngle/cameraMovement` | `shotType`, `cameraAngle`, `cameraMovement` |
| `location.timeOfDay/weather/lighting` | `timeOfDay`, `weather`, `lighting` |
| `imagePrompt` | `generatedPrompt` |
| `action` | `narration` |
| `generatedImages` | `generatedResults`, `activeResultIndex`, `generatedImageUrl` |

**Modal header badge:** When linked, shows "Linked: {script title} / {scene name}" with a Sync button to re-import.

**z-index requirement:** All `SelectContent` components inside SceneConfig must use `position="popper" className="z-[9999]"` to render above the Scene Editor Modal (z-[9998]).

**Implementation:** `frontend/src/components/editor/scene-config.tsx`, `frontend/src/types/nodes.ts`

#### Data Type

```typescript
interface SceneNodeDataType {
  label: string
  sceneName: string
  sceneNumber: number
  duration: number
  summary: string
  characters: Array<{
    assetId: string
    mood?: string
    action?: string
    positionInFrame?: string
  }>
  dialogue: Array<{
    characterName: string
    text: string
    emotion?: string
    voiceId?: string
    generatedAudioResults?: Array<{
      url: string
      jobId: string
      voiceId: string
      createdAt: string
    }>
    activeAudioIndex?: number
  }>
  locations: Array<{
    assetId: string
    name?: string
    isPrimary?: boolean
    timeOfDay?: string
    weather?: string
    lighting?: string
  }>
  objects: Array<{
    assetId: string
    description?: string
  }>
  shotType: string
  cameraAngle: string
  cameraMovement: string
  depthOfField: string
  lensType: string
  aspectRatio: string
  mood: string[]
  colorPalette: string[]
  visualStyle: string
  narration: string
  musicMood: string
  soundEffects: string[]
  transitionIn: string
  transitionOut: string
  directorNotes: string
  referenceUrls: string[]
  timeOfDay: string
  weather: string
  lighting: string
  // Script connection
  sourceScriptNodeId: string     // linked Generate Script node ID
  sourceSceneIndex: number       // scene index within script (-1 = none)
  autoSyncWithScript: boolean    // auto-import on scene change
  // Execution state
  executionStatus?: string
  generatedResults?: Array<{ jobId: string; url: string }>
  activeResultIndex?: number
  generatedImageUrl?: string
}
```

### Workflow Validation

Before running a workflow, the system validates it and shows warnings/errors.

**Validation runs:**
1. When user clicks "Run"
2. Before job is queued
3. Shows warnings in UI (user can proceed)
4. Shows errors in UI (user must fix)

#### Warnings (Can Proceed)

| Condition | Warning Message | Suggestion |
|-----------|-----------------|------------|
| VEO → Merge Video & Audio (no Extract) | "VEO video has audio. This may conflict with added audio." | Add Extract Audio node |
| Image node without reference | "No reference image. Character consistency may vary." | Add reference image |
| Long video (> 5 min) without checkpoints | "Long workflow without save points." | Add intermediate Save nodes |
| High credit cost (> 500) | "This workflow costs ~500 credits." | Confirm before run |

#### Errors (Must Fix)

| Condition | Error Message |
|-----------|---------------|
| No output node | "Workflow has no output. Add a Save or Webhook node." |
| Disconnected nodes | "Node 'X' is not connected to the workflow." |
| Circular reference | "Circular dependency detected between nodes." |
| Missing required input | "Node 'Generate Image' is missing required input 'prompt'." |
| Invalid configuration | "Node 'Text to Speech' has no voice selected." |
| Insufficient credits | "You need 209 credits but only have 50." |

#### Implementation

```typescript
interface ValidationResult {
  valid: boolean;
  errors: ValidationMessage[];
  warnings: ValidationMessage[];
  estimatedCredits: number;
}

interface ValidationMessage {
  nodeId: string;
  type: 'error' | 'warning';
  message: string;
  suggestion?: string;
  suggestedNode?: string;  // Node type to add
}

function validateWorkflow(workflow: Workflow): ValidationResult {
  const errors: ValidationMessage[] = [];
  const warnings: ValidationMessage[] = [];
  
  // Check for output node
  const hasOutput = workflow.nodes.some(n => 
    ['save-to-storage', 'webhook-output'].includes(n.type)
  );
  if (!hasOutput) {
    errors.push({
      nodeId: 'workflow',
      type: 'error',
      message: 'Workflow has no output. Add a Save or Webhook node.',
      suggestedNode: 'save-to-storage'
    });
  }
  
  // Check VEO + Merge Video & Audio conflict
  for (const node of workflow.nodes) {
    if (node.type === 'merge-video-audio') {
      const inputNode = getInputNode(workflow, node, 'video');
      if (inputNode?.type === 'image-to-video' && 
          (inputNode.data.provider === 'veo' || inputNode.data.provider === 'veo3')) {
        // Check if there's an Extract Audio between them
        if (!hasExtractAudioBetween(workflow, inputNode, node)) {
          warnings.push({
            nodeId: node.id,
            type: 'warning',
            message: 'VEO video has audio. This may conflict with added audio.',
            suggestion: 'Add Extract Audio node to separate VEO audio first.',
            suggestedNode: 'extract-audio'
          });
        }
      }
    }
  }
  
  // ... more validations
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    estimatedCredits: calculateCredits(workflow)
  };
}
```

#### UI Behavior

```
User clicks "Run"
       │
       ▼
  Validate Workflow
       │
       ├─ Errors? ──▶ Show errors, disable Run button
       │
       └─ Warnings? ──▶ Show warnings dialog
                              │
                    ┌─────────┴─────────┐
                    │                   │
                    ▼                   ▼
              "Fix Issues"        "Run Anyway"
                    │                   │
                    ▼                   ▼
              Back to editor      Queue job
```

### Execution Model

SceneNode uses **step-by-step execution**, not "run all at once". Users control the flow manually, approving results before proceeding.

#### Node States

| State | Description | Visual Indicator |
|-------|-------------|------------------|
| `idle` | Not yet run | Gray border |
| `waiting` | Waiting for upstream nodes to complete | Pulsing border |
| `running` | Currently executing | Spinning indicator |
| `done` | Completed successfully | Green border + preview |
| `error` | Failed | Red border + error message |

#### Node Actions

| Action | Description |
|--------|-------------|
| **Run** | Execute this node only |
| **Run from here** | Execute this node and all downstream nodes |
| **Regenerate** | Run again (if not satisfied with result) |
| **Approve** | Lock result and allow downstream to proceed |

#### How It Works

Each node shows:
- Status indicator (idle/waiting/running/done/error)
- Preview of result (when done) - thumbnail for images, player for video/audio
- Action buttons (Run, Regenerate, Approve)

This allows users to:
1. Generate character image -> not satisfied -> **Regenerate**
2. Satisfied -> **Approve** -> continue to next scene
3. Full control, no wasted credits on downstream nodes if upstream result is bad

#### Execution Flow

```
User clicks "Run" on a node
       │
       ▼
  Are upstream nodes done?
       │
       ├─ No ──▶ Show warning: "Run upstream nodes first"
       │
       └─ Yes ──▶ Execute node
                       │
                       ├─ Success ──▶ Show preview + "Approve" / "Regenerate"
                       │
                       └─ Failure ──▶ Show error + "Retry"
```

**"Run from here"** executes the entire subgraph from the selected node downstream, auto-approving intermediate results. Useful when the user is confident in all upstream results and wants to batch-execute the rest.

---

### Credit Cost Table

| Node Type | Credits | ~Cost to Us | Price to User |
|-----------|---------|-------------|---------------|
| generate-script | 2 | $0.01 | $0.02 |
| generate-image | 5 | $0.02 | $0.04 |
| image-to-video | 20 | $0.10 | $0.20 |
| text-to-speech | 3 | $0.01 | $0.02 |
| qa-check | 1 | $0.005 | $0.01 |
| combine-videos | 2 | $0.01 | $0.02 |
| merge-video-audio | 1 | $0.005 | $0.01 |
| generate-music | 3 | $0.01 | $0.02 |
| text-to-audio | 3 | $0.01 | $0.02 |
| add-captions | 2 | $0.01 | $0.02 |
| resize-video | 1 | $0.005 | $0.01 |
| **extract-audio** | 1 | $0.005 | $0.01 |
| **mix-audio** | 1 | $0.005 | $0.01 |
| **adjust-volume** | 0 | $0 | $0 |
| **trim-video** | 0 | $0 | $0 |

**Note:** Simple processing nodes (adjust-volume, trim-video) are FREE - no AI involved.

**Total for typical 1-minute video (8 scenes):**
- Script: 2 credits
- Images: 8 × 5 = 40 credits
- Videos: 8 × 20 = 160 credits
- Voice: 3 credits
- Combine: 2 credits
- Captions: 2 credits
- **Total: ~209 credits (~$2.09)**

**Total for video with mixed audio (VEO ambient + ElevenLabs):**
- Script: 2 credits
- Images: 8 × 5 = 40 credits
- Videos: 8 × 20 = 160 credits
- Extract Audio: 1 credit
- Voice (ElevenLabs): 3 credits
- Mix Audio: 1 credit
- Combine: 2 credits
- Captions: 2 credits
- **Total: ~211 credits (~$2.11)**

---

## API Specification

### Authentication

```
Authorization: Bearer sn_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

API keys start with:
- `sn_live_` - Production keys
- `sn_test_` - Test keys (sandbox mode)

### Base URL

```
Production: https://api.scenenode.ai/v1
Self-hosted: https://your-domain.com/api/v1
```

### Endpoints

#### Projects

```
GET    /projects                 - List all projects
POST   /projects                 - Create project
GET    /projects/:id             - Get project
PATCH  /projects/:id             - Update project
DELETE /projects/:id             - Delete project
```

#### Workflows

```
GET    /projects/:id/workflows   - List workflows in project
POST   /projects/:id/workflows   - Create workflow
GET    /workflows/:id            - Get workflow
PATCH  /workflows/:id            - Update workflow
DELETE /workflows/:id            - Delete workflow
POST   /workflows/:id/duplicate  - Duplicate workflow
```

#### Jobs (Executions)

```
POST   /workflows/:id/run        - Execute workflow
GET    /jobs                     - List all jobs
GET    /jobs/:id                 - Get job status
GET    /jobs/:id/progress        - Get detailed progress (SSE stream)
POST   /jobs/:id/cancel          - Cancel job
POST   /jobs/:id/retry           - Retry failed job
```

#### Quick Render (Simplified API for n8n users)

```
POST   /render                   - One-shot video generation
```

Request:
```json
{
  "prompt": "A story about a brave knight",
  "style": "children-book",
  "duration": 60,
  "voice": "narrator-male",
  "aspect_ratio": "9:16",
  "webhook_url": "https://your-n8n.com/webhook/xxx",
  "options": {
    "add_captions": true,
    "caption_style": "word-highlight",
    "background_music": "epic-orchestral"
  }
}
```

Response:
```json
{
  "job_id": "job_xxxxx",
  "status": "queued",
  "estimated_credits": 209,
  "estimated_duration_seconds": 180,
  "progress_url": "https://api.scenenode.ai/v1/jobs/job_xxxxx/progress"
}
```

#### Assets

```
GET    /assets                   - List assets
GET    /assets/:id               - Get asset details
DELETE /assets/:id               - Delete asset
POST   /assets/upload            - Upload asset (multipart)
```

#### Webhooks

```
GET    /webhooks                 - List webhooks
POST   /webhooks                 - Create webhook
PATCH  /webhooks/:id             - Update webhook
DELETE /webhooks/:id             - Delete webhook
GET    /webhooks/:id/deliveries  - List delivery attempts
POST   /webhooks/:id/test        - Send test webhook
```

#### Account

```
GET    /account                  - Get account info
GET    /account/usage            - Get usage stats
GET    /account/api-keys         - List API keys
POST   /account/api-keys         - Create API key
DELETE /account/api-keys/:id     - Revoke API key
```

### Webhook Payload

```json
{
  "event": "job.completed",
  "timestamp": "2026-01-29T21:30:00Z",
  "data": {
    "job_id": "job_xxxxx",
    "workflow_id": "wf_xxxxx",
    "status": "completed",
    "duration_seconds": 165,
    "credits_used": 209,
    "output": {
      "video_url": "https://r2.scenenode.ai/xxxxx/output.mp4",
      "thumbnail_url": "https://r2.scenenode.ai/xxxxx/thumb.jpg",
      "duration": 62.5,
      "resolution": "1080x1920"
    }
  }
}
```

### Webhook Signature

```
X-SceneNode-Signature: sha256=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Verify with:
```python
import hmac
import hashlib

def verify_webhook(payload: bytes, signature: str, secret: str) -> bool:
    expected = 'sha256=' + hmac.new(
        secret.encode(),
        payload,
        hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature)
```

### Rate Limits

| Tier | Requests/Minute | Headers |
|------|-----------------|---------|
| Free | 5 | X-RateLimit-Limit, X-RateLimit-Remaining |
| Basic | 30 | X-RateLimit-Reset |
| Pro | 60 | |
| Business | 120 | |
| Enterprise | 300 | |

### Idempotency

Prevent duplicate charges when user clicks "Run" twice accidentally.

**Header:**
```
X-Idempotency-Key: <unique-string>
```

**Behavior:**
| Scenario | Result |
|----------|--------|
| Same key sent within 5 minutes | Return existing job (no new charge) |
| Same key after 5 minutes | Create new job |
| No key provided | Create new job (default) |

**Client generates:**
```javascript
const idempotencyKey = `${workflowId}-${Date.now()}-${crypto.randomUUID()}`;
```

**Server implementation:**
```python
async def create_job(request: Request, workflow_id: str):
    idempotency_key = request.headers.get("X-Idempotency-Key")
    
    if idempotency_key:
        # Check if job with this key exists (created < 5 min ago)
        existing = await db.jobs.find_one({
            "idempotency_key": idempotency_key,
            "created_at": {"$gt": datetime.now() - timedelta(minutes=5)}
        })
        if existing:
            return existing  # Return existing job, no new charge
    
    # Create new job
    job = await create_new_job(workflow_id, idempotency_key)
    return job
```

**Why this matters:**
- User double-clicks "Run" → Charged once, not twice
- Network retry → Same job returned
- n8n webhook retry → No duplicate videos

### Error Responses

```json
{
  "error": {
    "code": "insufficient_credits",
    "message": "You need 209 credits but only have 50",
    "details": {
      "required": 209,
      "available": 50
    }
  }
}
```

Error codes:
- `unauthorized` - Invalid or missing API key
- `forbidden` - Valid key but no permission
- `not_found` - Resource doesn't exist
- `validation_error` - Invalid request body
- `insufficient_credits` - Not enough credits
- `rate_limited` - Too many requests
- `provider_error` - AI provider failed
- `internal_error` - Our fault

---

## n8n Integration

### Overview

SceneNode provides an official n8n community node for seamless integration. Users can create videos directly from their n8n workflows.

**Target:** n8n users who want to automate video creation as part of larger workflows (RSS → Video → TikTok).

### n8n Node - 3 Operations (MVP)

| Operation | Use Case | Input | Output |
|-----------|----------|-------|--------|
| **Quick Render** | 90% of users | text | video_url |
| **Run Workflow** | Complex flows | workflow_id + variables | video_url |
| **Get Job Status** | Async mode | job_id | status + video_url |

### Credential Setup

The n8n Node supports two connection types:

#### Option 1: SceneNode Cloud (Recommended)

```
┌─────────────────────────────────────────────────────────────────┐
│  SceneNode API - Credential                                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Connection Type: [SceneNode Cloud ▼]                           │
│                   ├─ SceneNode Cloud (recommended)              │
│                   └─ Self-Hosted                                │
│                                                                 │
│  ───────────────────────────────────────────────────            │
│                                                                 │
│  API Key *: [sn_live_••••••••••••••••••••••••]                 │
│                                                                 │
│  ℹ️ Get your API key from:                                      │
│     https://scenenode.ai/settings/api-keys                      │
│                                                                 │
│                                         [Test] [Save]           │
└─────────────────────────────────────────────────────────────────┘
```

#### Option 2: Self-Hosted (Requires License)

```
┌─────────────────────────────────────────────────────────────────┐
│  SceneNode API - Credential                                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Connection Type: [Self-Hosted ▼]                               │
│                   ├─ SceneNode Cloud (recommended)              │
│                   └─ Self-Hosted                                │
│                                                                 │
│  ───────────────────────────────────────────────────            │
│                                                                 │
│  License Key *: [lic_••••••••••••••••••••••••]                 │
│                                                                 │
│  Server URL *:  [https://my-server.com/api      ]              │
│                                                                 │
│  ───────────────────────────────────────────────────            │
│                                                                 │
│  ℹ️ Self-Hosted License: $9/month                               │
│     • Unlimited usage                                           │
│     • You pay AI providers directly                             │
│     • No watermark                                              │
│                                                                 │
│     Get license: https://scenenode.ai/pricing/self-hosted       │
│                                                                 │
│                                         [Test] [Save]           │
└─────────────────────────────────────────────────────────────────┘
```

### License Validation (Self-Hosted)

```
n8n Node ──▶ Self-Hosted SceneNode ──▶ Validates license
                                              │
                                              ▼
                                       license.scenenode.ai
                                       (checks if key valid)
                                              │
                                              ▼
                                       ✅ Valid → Works
                                       ❌ Invalid → Error
```

**License server only checks:**
- Is the license key valid?
- Is it not revoked?

**No user data is transmitted.**

### Operation 1: Quick Render

The most common operation - turn text into a complete video.

```
┌─────────────────────────────────────────────────────────────────┐
│  SceneNode - Quick Render                                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─ REQUIRED ─────────────────────────────────────────────────┐ │
│  │                                                             │ │
│  │  Text *                                                     │ │
│  │  ┌─────────────────────────────────────────────────────┐   │ │
│  │  │ {{ $json.article_text }}                            │   │ │
│  │  └─────────────────────────────────────────────────────┘   │ │
│  │  The text/story to turn into a video                        │ │
│  │                                                             │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌─ OPTIONS ──────────────────────────────────────────────────┐ │
│  │                                                             │ │
│  │  Style                     Duration (seconds)               │ │
│  │  [Children's Story ▼]      [60                    ]        │ │
│  │                                                             │ │
│  │  Aspect Ratio              Voice                            │ │
│  │  [9:16 (TikTok/Reels) ▼]   [Narrator - Male ▼]             │ │
│  │                                                             │ │
│  │  ☑️ Add Captions                                            │ │
│  │                                                             │ │
│  │  Caption Style                                              │ │
│  │  [Word Highlight ▼]                                         │ │
│  │                                                             │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌─ ADVANCED ─────────────────────────────────────────────────┐ │
│  │                                                             │ │
│  │  Reference Image (for character consistency)                │ │
│  │  ┌─────────────────────────────────────────────────────┐   │ │
│  │  │ {{ $json.character_url }}                           │   │ │
│  │  └─────────────────────────────────────────────────────┘   │ │
│  │                                                             │ │
│  │  Image Provider            Video Provider                   │ │
│  │  [Nano Banana ▼]           [VEO 3.1 ▼]                     │ │
│  │                                                             │ │
│  │  Wait for Completion                                        │ │
│  │  [Yes ▼]                                                    │ │
│  │  ├─ Yes (wait up to 10 min)                                │ │
│  │  └─ No (return job_id, use webhook)                        │ │
│  │                                                             │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Output (Wait = Yes):**
```json
{
  "job_id": "job_abc123",
  "status": "completed",
  "video_url": "https://r2.scenenode.ai/xxx/video.mp4",
  "thumbnail_url": "https://r2.scenenode.ai/xxx/thumb.jpg",
  "duration": 62.5,
  "resolution": "1080x1920",
  "credits_used": 209
}
```

**Output (Wait = No):**
```json
{
  "job_id": "job_abc123",
  "status": "processing",
  "progress_url": "https://api.scenenode.ai/v1/jobs/job_abc123"
}
```

### Operation 2: Run Workflow

Run a workflow created in SceneNode UI, passing variables from n8n.

```
┌─────────────────────────────────────────────────────────────────┐
│  SceneNode - Run Workflow                                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─ REQUIRED ─────────────────────────────────────────────────┐ │
│  │                                                             │ │
│  │  Workflow *                                                 │ │
│  │  [My Story Template ▼]                                      │ │
│  │  ├─ My Story Template (wf_abc123)                          │ │
│  │  ├─ News to Video (wf_def456)                              │ │
│  │  ├─ Product Ad (wf_ghi789)                                 │ │
│  │  └─ + Create at scenenode.ai                               │ │
│  │                                                             │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌─ WORKFLOW VARIABLES ───────────────────────────────────────┐ │
│  │                                                             │ │
│  │  ℹ️ Variables defined in your SceneNode workflow:           │ │
│  │                                                             │ │
│  │  prompt * (required)                                        │ │
│  │  ┌─────────────────────────────────────────────────────┐   │ │
│  │  │ {{ $json.article_text }}                            │   │ │
│  │  └─────────────────────────────────────────────────────┘   │ │
│  │                                                             │ │
│  │  reference_image (optional)                                 │ │
│  │  ┌─────────────────────────────────────────────────────┐   │ │
│  │  │ {{ $json.main_image }}                              │   │ │
│  │  └─────────────────────────────────────────────────────┘   │ │
│  │                                                             │ │
│  │  style (optional, default: "children")                      │ │
│  │  ┌─────────────────────────────────────────────────────┐   │ │
│  │  │                                                     │   │ │
│  │  └─────────────────────────────────────────────────────┘   │ │
│  │                                                             │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌─ OPTIONS ──────────────────────────────────────────────────┐ │
│  │                                                             │ │
│  │  Wait for Completion                                        │ │
│  │  [Yes ▼]                                                    │ │
│  │                                                             │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Output:**
```json
{
  "job_id": "job_xyz789",
  "workflow_id": "wf_abc123",
  "workflow_name": "My Story Template",
  "status": "completed",
  "outputs": {
    "video": {
      "url": "https://r2.scenenode.ai/xxx/video.mp4",
      "duration": 65.2
    },
    "thumbnail": {
      "url": "https://r2.scenenode.ai/xxx/thumb.jpg"
    }
  },
  "credits_used": 215
}
```

### Operation 3: Get Job Status

Check the status of an async job.

```
┌─────────────────────────────────────────────────────────────────┐
│  SceneNode - Get Job Status                                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Job ID *                                                       │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ {{ $json.job_id }}                                      │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Output (in progress):**
```json
{
  "job_id": "job_abc123",
  "status": "processing",
  "progress": 45,
  "current_step": "Generating video for scene 4/8",
  "started_at": "2026-01-29T21:30:00Z",
  "estimated_completion": "2026-01-29T21:33:00Z"
}
```

**Output (completed):**
```json
{
  "job_id": "job_abc123",
  "status": "completed",
  "progress": 100,
  "video_url": "https://r2.scenenode.ai/xxx/video.mp4",
  "thumbnail_url": "https://r2.scenenode.ai/xxx/thumb.jpg",
  "duration": 62.5,
  "credits_used": 209,
  "started_at": "2026-01-29T21:30:00Z",
  "completed_at": "2026-01-29T21:33:15Z"
}
```

**Output (failed):**
```json
{
  "job_id": "job_abc123",
  "status": "failed",
  "error": "Image generation failed: Rate limit exceeded",
  "failed_at_step": "generate-images",
  "credits_used": 2
}
```

### Example n8n Flow: News to TikTok

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         n8n: News to TikTok                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌──────────────┐                                                           │
│   │  📰 RSS      │  output: {title, link, description}                      │
│   │  Tech News   │                                                           │
│   └──────┬───────┘                                                           │
│          │                                                                   │
│          ▼                                                                   │
│   ┌──────────────┐                                                           │
│   │  🌐 HTTP     │  output: {article_text, main_image}                      │
│   │  Request     │  (scrape full article)                                   │
│   └──────┬───────┘                                                           │
│          │                                                                   │
│          ▼                                                                   │
│   ┌──────────────┐                                                           │
│   │  🎬 Scene    │  Operation: Quick Render                                  │
│   │     Node     │  Text: {{ $json.article_text }}                          │
│   │              │  Style: News Report                                       │
│   │              │  Wait: Yes                                                │
│   └──────┬───────┘                                                           │
│          │         output: {video_url, thumbnail_url}                        │
│          ▼                                                                   │
│   ┌──────────────┐                                                           │
│   │  📱 TikTok   │  video: {{ $json.video_url }}                            │
│   │   Upload     │                                                           │
│   └──────┬───────┘                                                           │
│          │         output: {post_url}                                        │
│          ▼                                                                   │
│   ┌──────────────┐                                                           │
│   │  💬 Telegram │  "New video: {{ $json.post_url }}"                       │
│   │   Message    │                                                           │
│   └──────────────┘                                                           │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Workflow Variables (SceneNode UI)

Users can define variables in their SceneNode workflows that can be passed from n8n:

```
┌─────────────────────────────────────────────────────────────────┐
│  Workflow Settings (SceneNode UI)                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Variables (for API/n8n):                                       │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Name            │ Type     │ Default    │ Required      │   │
│  ├─────────────────────────────────────────────────────────┤   │
│  │ prompt          │ string   │ -          │ ✅            │   │
│  │ reference_image │ url      │ -          │ ☐             │   │
│  │ voice_text      │ string   │ {{prompt}} │ ☐             │   │
│  │ style           │ select   │ children   │ ☐             │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  [+ Add Variable]                                               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Async Mode with Webhook

For long-running jobs, use async mode with n8n's built-in webhook:

```
n8n timeout = 60 seconds (default)
Video generation = 3-5 minutes
Solution: Async + Webhook
```

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  SceneNode   │     │   n8n Wait   │     │   Continue   │
│  Quick Render│────▶│   (paused)   │────▶│   Workflow   │
│  Wait: No    │     │              │     │              │
└──────────────┘     └──────────────┘     └──────────────┘
       │                    ▲
       │                    │
       └── webhook ─────────┘
           (when video ready)
```

### Phase 2 Operations (Future)

| Operation | Use Case |
|-----------|----------|
| Generate Script | Get script only, review before video |
| Generate Images | Get images only |
| Generate Video | Convert images to video clips |
| Generate Voice | Get voiceover only |

These will be added for power users who need granular control.

---

## Editions & Pricing Model

### Three Editions

| Edition | Price | Who It's For |
|---------|-------|--------------|
| **Self-Hosted** | $0 | Developers who want full control |
| **Self-Hosted + n8n** | $9/month | Developers who need n8n integration |
| **Cloud** | $25-200/month | Businesses who want managed service |

### What's the Difference?

**It's the SAME code.** The only difference is where it runs and who manages it.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           SELF-HOSTED (FREE)                                 │
│                                                                              │
│   You install on your server + You bring your own API keys                  │
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  SceneNode                                                          │   │
│   │  ✅ Visual Editor                                                   │   │
│   │  ✅ All Nodes                                                       │   │
│   │  ✅ API                                                             │   │
│   │  ✅ Webhooks                                                        │   │
│   │  ✅ Unlimited usage (you pay Gemini/ElevenLabs directly)           │   │
│   │  ✅ No watermark                                                    │   │
│   │  ❌ n8n Node (requires license)                                    │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│   Cost: $0 to us, ~$X/month to AI providers based on usage                  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                      SELF-HOSTED + n8n LICENSE ($9/month)                    │
│                                                                              │
│   Same as above + Official n8n Node                                         │
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  SceneNode (SAME CODE)                                              │   │
│   │  ✅ Everything from Self-Hosted                                     │   │
│   │  ✅ Official n8n Node                                               │   │
│   │                                                                     │   │
│   │  License Key: [lic_xxxxxxxxxxxx]                                    │   │
│   │         │                                                           │   │
│   │         ▼                                                           │   │
│   │  license.scenenode.ai ──▶ "Did they pay this month?" ──▶ ✅/❌     │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│   Cost: $9/month to us (pure profit), ~$X/month to AI providers             │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                           CLOUD ($25-200/month)                              │
│                                                                              │
│   We manage everything. You just use it.                                    │
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  SceneNode Cloud                                                    │   │
│   │  ✅ Everything from Self-Hosted                                     │   │
│   │  ✅ n8n Node included                                               │   │
│   │  ✅ Managed infrastructure                                          │   │
│   │  ✅ Priority Queue                                                  │   │
│   │  ✅ Team Collaboration                                              │   │
│   │  ✅ Analytics                                                       │   │
│   │  ✅ Support (Email/Priority/SLA)                                    │   │
│   │  ✅ SSO/SAML (Enterprise)                                           │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│   Cost: $25-200/month to us (includes AI costs via credits)                 │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Feature Comparison

| Feature | Self-Hosted | Self-Hosted + n8n | Cloud |
|---------|-------------|-------------------|-------|
| **Price** | $0 | $9/month | $25-200/month |
| Visual Editor | ✅ | ✅ | ✅ |
| All Nodes | ✅ | ✅ | ✅ |
| API | ✅ | ✅ | ✅ |
| Webhooks | ✅ | ✅ | ✅ |
| Unlimited Usage | ✅ | ✅ | By credits |
| No Watermark | ✅ | ✅ | Pro+ |
| **n8n Node** | ❌ | ✅ | ✅ |
| Priority Queue | ❌ | ❌ | Pro+ |
| Team Collaboration | ❌ | ❌ | ✅ |
| Analytics | ❌ | ❌ | ✅ |
| SSO/SAML | ❌ | ❌ | Enterprise |
| Support | Community | Basic | Email/Priority/SLA |

### Cloud Pricing Tiers

| Tier | Price | Credits/Month | Storage | Max Video | Resolution |
|------|-------|---------------|---------|-----------|------------|
| **Free** | $0 | 50 | 1 GB | 1 min | 720p |
| **Basic** | $25 | 500 | 10 GB | 3 min | 1080p |
| **Pro** | $49 | 1,200 | 50 GB | 10 min | 1080p |
| **Business** | $99 | 3,000 | 200 GB | 30 min | 4K |
| **Enterprise** | $200 | 7,000 | 500 GB | Unlimited | 4K |

### Cloud Feature Matrix

| Feature | Free | Basic | Pro | Business | Enterprise |
|---------|------|-------|-----|----------|------------|
| API Access | ❌ | ✅ | ✅ | ✅ | ✅ |
| Webhooks | ❌ | ✅ | ✅ | ✅ | ✅ |
| n8n Node | ❌ | ✅ | ✅ | ✅ | ✅ |
| Projects | 1 | 3 | 10 | Unlimited | Unlimited |
| Team Members | 1 | 1 | 3 | 10 | Unlimited |
| Remove Watermark | ❌ | ❌ | ✅ | ✅ | ✅ |
| Priority Queue | ❌ | ❌ | ✅ | ✅ | ✅ |
| Analytics | ❌ | Basic | Full | Full | Full + Export |
| SSO/SAML | ❌ | ❌ | ❌ | ✅ | ✅ |
| Audit Logs | ❌ | ❌ | ❌ | ✅ | ✅ |
| White-label | ❌ | ❌ | ❌ | ❌ | ✅ |
| Support | Forum | Forum | Email | Priority | Dedicated SLA |

### Credit Top-ups (Cloud Only)

| Credits | Price | Per Credit |
|---------|-------|------------|
| 500 | $10 | $0.020 |
| 1,500 | $25 | $0.017 |
| 5,000 | $75 | $0.015 |
| 15,000 | $200 | $0.013 |

### License Validation (Self-Hosted + n8n)

The n8n Node checks license validity on startup and periodically:

```python
# Runs when n8n Node initializes
async def validate_license(license_key: str) -> bool:
    response = await fetch("https://license.scenenode.ai/validate", {
        "key": license_key
    })
    return response.valid and not response.revoked

# What we check:
# ✅ Is the key format valid?
# ✅ Is the key in our database?
# ✅ Has the user paid this month?
# ✅ Is the key not revoked?

# What we DON'T collect:
# ❌ User data
# ❌ Workflow data
# ❌ Usage statistics
# ❌ IP addresses (beyond basic request)
```

### Revenue Model Summary

| Edition | Revenue | Our Cost | Profit |
|---------|---------|----------|--------|
| Self-Hosted | $0 | $0 | $0 |
| Self-Hosted + n8n | $9/month | ~$0 | ~$9/month |
| Cloud | $25-200/month | AI + Infra | Variable |

### Who Chooses What?

```
Developer wants to try it?
    │
    └─▶ Self-Hosted (free) ──▶ Likes it?
                                   │
                    ┌──────────────┴──────────────┐
                    │                             │
                    ▼                             ▼
            Needs n8n?                    Doesn't want to
                │                         manage servers?
                ▼                             │
        Self-Hosted + n8n                     ▼
           ($9/month)                   Cloud ($25+/month)
```

---

## Environment Variables

### Required (All Deployments)

```bash
# Database & Auth
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Google OAuth (configure in Supabase Dashboard → Authentication → Providers → Google)
# Required: Google Cloud Console → Create OAuth 2.0 credentials
# Redirect URL: https://xxxxx.supabase.co/auth/v1/callback

# Storage
R2_ACCOUNT_ID=xxxxx
R2_ACCESS_KEY_ID=xxxxx
R2_SECRET_ACCESS_KEY=xxxxx
R2_BUCKET_NAME=scenenode-assets
R2_PUBLIC_URL=https://assets.scenenode.ai

# Redis
REDIS_URL=redis://default:xxxxx@xxxxx.railway.app:6379

# Security
API_SECRET_KEY=xxxxx  # For signing API keys
WEBHOOK_SECRET_KEY=xxxxx  # Default webhook signing
ENCRYPTION_KEY=xxxxx  # For encrypting sensitive data
```

### AI Providers (MVP)

```bash
# Replicate - provides access to all models needed for MVP
# Nano Banana, VEO, Gemini Flash - all available through Replicate
REPLICATE_API_TOKEN=r8_xxxxx
```

### AI Providers (Optional - Phase 2+)

```bash
# Direct API access (if needed for pricing/rate limits)
GEMINI_API_KEY=xxxxx           # Direct Google access
OPENAI_API_KEY=xxxxx           # For DALL-E, GPT
ANTHROPIC_API_KEY=xxxxx        # For Claude QA
ELEVENLABS_API_KEY=xxxxx       # For voice (better quality)
KLING_API_KEY=xxxxx            # Direct Kling access
RUNWAY_API_KEY=xxxxx           # Direct Runway access
```

### Payments (Cloud only)

```bash
PADDLE_API_KEY=pdl_live_xxxxx
PADDLE_WEBHOOK_SECRET=whsec_xxxxx
PADDLE_PRICE_ID_BASIC=pri_xxxxx
PADDLE_PRICE_ID_PRO=pri_xxxxx
PADDLE_PRICE_ID_BUSINESS=pri_xxxxx
PADDLE_PRICE_ID_ENTERPRISE=pri_xxxxx
```

### Optional

```bash
# Email (for webhook failure notifications)
RESEND_API_KEY=xxxxx
FROM_EMAIL=notifications@scenenode.ai

# Monitoring
SENTRY_DSN=https://xxxxx@sentry.io/xxxxx

# Feature flags
ENABLE_ANALYTICS=true
ENABLE_WATERMARK=true  # Set false for self-hosted
```

---

## Deployment

### Cloud (Managed)

```
Frontend:  Vercel
Backend:   Railway (Fastify)
Workers:   Railway (Node.js workers)
Redis:     Railway (Redis)
Database:  Supabase (managed)
Storage:   Cloudflare R2
```

### Self-Hosted (Docker Compose)

```yaml
version: '3.8'

services:
  frontend:
    build: ./frontend
    ports:
      - "3000:3000"
    environment:
      - NEXT_PUBLIC_API_URL=http://localhost:8000
    depends_on:
      - backend

  backend:
    build: ./backend
    ports:
      - "8000:8000"
    environment:
      - DATABASE_URL=${DATABASE_URL}
      - REDIS_URL=redis://redis:6379
      - R2_ACCOUNT_ID=${R2_ACCOUNT_ID}
      # ... other env vars
    depends_on:
      - redis
      - postgres

  worker:
    build: ./backend
    command: npm run worker
    environment:
      - REDIS_URL=redis://redis:6379
      # ... same as backend
    depends_on:
      - redis
      - backend
    deploy:
      replicas: 2  # Scale based on load

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data

  postgres:
    image: postgres:15-alpine
    environment:
      - POSTGRES_DB=scenenode
      - POSTGRES_USER=scenenode
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  redis_data:
  postgres_data:
```

### Self-Hosted Notes

1. **Bring Your Own API Keys**: Self-hosters provide their own AI provider keys
2. **No Paddle**: Billing disabled, unlimited usage
3. **No Watermark**: Configurable via env var
4. **Local Storage Option**: Can use local filesystem instead of R2

---

## Monitoring & Observability

### Error Tracking (Sentry)

```python
# backend/scenenode/config.py
import sentry_sdk

sentry_sdk.init(
    dsn=os.getenv("SENTRY_DSN"),
    environment=os.getenv("ENVIRONMENT", "development"),
    traces_sample_rate=0.1,
)
```

**What to capture:**
- Failed jobs (with workflow_id, user_id, error message)
- Provider errors (API failures, timeouts)
- Unexpected exceptions
- Slow transactions (> 30s)

### Metrics (Prometheus + Grafana)

**Key metrics to track:**

| Metric | Type | Description |
|--------|------|-------------|
| `jobs_total` | Counter | Total jobs created |
| `jobs_completed` | Counter | Successfully completed jobs |
| `jobs_failed` | Counter | Failed jobs |
| `job_duration_seconds` | Histogram | Time to complete job |
| `queue_depth` | Gauge | Jobs waiting in queue |
| `credits_consumed` | Counter | Total credits used |
| `provider_requests` | Counter | Requests to AI providers |
| `provider_latency` | Histogram | AI provider response time |

**Example implementation:**
```python
from prometheus_client import Counter, Histogram, Gauge

jobs_total = Counter('jobs_total', 'Total jobs', ['workflow_type'])
jobs_completed = Counter('jobs_completed', 'Completed jobs')
jobs_failed = Counter('jobs_failed', 'Failed jobs', ['error_type'])
job_duration = Histogram('job_duration_seconds', 'Job duration')
queue_depth = Gauge('queue_depth', 'Jobs in queue', ['queue_name'])
```

### Alerts

| Condition | Severity | Action |
|-----------|----------|--------|
| Job stuck > 10 minutes | Warning | Slack notification |
| Job stuck > 30 minutes | Critical | PagerDuty + auto-retry |
| Error rate > 5% (5 min window) | Critical | PagerDuty |
| Queue depth > 100 | Warning | Slack notification |
| Queue depth > 500 | Critical | Scale workers |
| Worker offline > 2 minutes | Critical | PagerDuty |
| Provider error rate > 10% | Warning | Slack + check provider status |

### Dead Letter Queue

Failed jobs after max retries go to DLQ for manual inspection:

```python
# Worker configuration
RETRY_ATTEMPTS = 3
RETRY_DELAY = [60, 300, 900]  # 1min, 5min, 15min

async def process_job(job):
    try:
        await execute_workflow(job)
    except Exception as e:
        if job.attempts >= RETRY_ATTEMPTS:
            await move_to_dlq(job, error=str(e))
            await notify_admin(job)
        else:
            raise  # BullMQ will retry
```

### Health Checks

```python
# backend/scenenode/api/routes/health.py

@router.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "version": settings.VERSION,
        "checks": {
            "database": await check_database(),
            "redis": await check_redis(),
            "storage": await check_r2(),
        }
    }

@router.get("/health/workers")
async def worker_health():
    return {
        "active_workers": await get_active_worker_count(),
        "queue_depths": {
            "video": await get_queue_depth("video"),
            "image": await get_queue_depth("image"),
            "voice": await get_queue_depth("voice"),
        },
        "jobs_processing": await get_processing_count(),
    }
```

### Dashboard (Grafana)

**Panels to include:**
1. Jobs per minute (line chart)
2. Success vs failure rate (pie chart)
3. Average job duration (line chart)
4. Queue depths (stacked area)
5. Credits consumed per hour (bar chart)
6. Provider latency by provider (line chart)
7. Error rate by error type (stacked bar)
8. Active workers (gauge)

---

## License

### Sustainable Use License

Based on the n8n/Fair-code model:

```
SceneNode.ai Sustainable Use License

Copyright (c) 2026 [Company Name]

Permission is hereby granted to any person obtaining a copy of this 
software and associated documentation files (the "Software"):

1. PERMITTED USES:
   - Use the Software for personal projects
   - Use the Software for internal business purposes
   - Modify the Software for your own use
   - Self-host the Software on your own infrastructure

2. PROHIBITED USES:
   - Offering the Software as a commercial hosted service to third parties
   - Selling, licensing, or sublicensing the Software
   - Removing or modifying license/attribution notices

3. ATTRIBUTION:
   - You must retain all copyright and license notices
   - If you modify the Software, you must indicate changes made

4. NO WARRANTY:
   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.

For commercial hosting licenses, contact: license@scenenode.ai
```

### What's Open

| Component | Open Source |
|-----------|-------------|
| Visual Editor | ✅ |
| All Nodes | ✅ |
| API Server | ✅ |
| Workers | ✅ |
| Database Schema | ✅ |

### What's Cloud-Only

| Component | Reason |
|-----------|--------|
| Queue Priority | Requires managed infrastructure |
| Analytics Dashboard | Connected to billing |
| Team Collaboration | Requires central auth |
| SSO/SAML | Enterprise feature |
| White-label | Enterprise feature |

---

## Repository Architecture

### Two Separate Repositories

**The website and the application are completely separate codebases.**

| Repository | URL | Purpose |
|------------|-----|---------|
| `scenenode` | app.scenenode.ai | The application (product) |
| `scenenode-website` | scenenode.ai | Marketing website (landing page) |

**Why separate?**
- Claude Code can't accidentally break the app when working on the website
- Different deploy pipelines
- Different technologies if needed
- Clear separation of concerns

### URL Structure

```
scenenode.ai              → Marketing website (landing page, pricing, about)
app.scenenode.ai          → The application (dashboard, editor, settings)
api.scenenode.ai          → The API (Fastify backend)
docs.scenenode.ai         → Documentation (Docusaurus/GitBook)
license.scenenode.ai      → License validation server (for n8n Node)
```

### Repository 1: scenenode (Application)

```
github.com/scenenode/scenenode

scenenode/
├── frontend/              # Next.js 14 - The App
├── backend/               # Fastify - The API
├── docker-compose.yml
├── README.md
└── CLAUDE.md
```

**Deployed to:**
- Frontend: Vercel (app.scenenode.ai)
- Backend: Railway (api.scenenode.ai)

### Repository 2: scenenode-website (Marketing)

```
github.com/scenenode/scenenode-website

scenenode-website/
├── src/
│   ├── pages/
│   │   ├── index.astro        # Home page
│   │   ├── pricing.astro      # Pricing page
│   │   ├── about.astro        # About page
│   │   └── contact.astro      # Contact page
│   ├── components/
│   │   ├── Hero.astro
│   │   ├── Features.astro
│   │   ├── Pricing.astro
│   │   ├── Testimonials.astro
│   │   └── Footer.astro
│   └── layouts/
│       └── Layout.astro
├── public/
│   └── images/
├── package.json
└── README.md
```

**Technology:** Astro (or simple HTML/Tailwind - fast, SEO-friendly)

**Deployed to:** Vercel (scenenode.ai)

### Why Astro for Website?

| Criteria | Next.js | Astro |
|----------|---------|-------|
| Purpose | App (interactive) | Website (static) |
| JS shipped | A lot | Almost zero |
| Build time | Slower | Fast |
| SEO | Good | Excellent |
| Complexity | Higher | Lower |

**The app needs Next.js (React, state, interactivity).**
**The website just needs to look good and load fast.**

### Claude Code Instructions

```
⚠️ IMPORTANT: Website and App are SEPARATE repositories.

When working on the WEBSITE (scenenode-website):
- Only touch files in scenenode-website/
- Never import from the app
- Focus on: landing page, pricing, marketing

When working on the APP (scenenode):
- Only touch files in scenenode/
- Never touch the website
- Focus on: editor, dashboard, API
```

---

## Project Structure

```
scenenode/
├── frontend/                    # Next.js 14
│   ├── app/
│   │   ├── (auth)/             # Login, signup
│   │   ├── (dashboard)/        # Main app
│   │   │   ├── projects/
│   │   │   ├── workflows/
│   │   │   ├── jobs/
│   │   │   └── settings/
│   │   └── api/                # Next.js API routes (proxy)
│   ├── components/
│   │   ├── editor/             # React Flow editor
│   │   ├── nodes/              # Custom node components
│   │   └── ui/                 # shadcn/ui components
│   ├── lib/
│   │   ├── supabase.ts
│   │   ├── api.ts
│   │   └── utils.ts
│   └── package.json
│
├── backend/                           # Fastify (Node.js/TypeScript)
│   ├── src/
│   │   ├── server.ts                 # Entry point
│   │   ├── app.ts                    # Fastify app builder
│   │   ├── worker.ts                 # Worker entry point
│   │   ├── lib/
│   │   │   ├── config.ts            # Zod-validated env config
│   │   │   ├── supabase.ts          # Supabase client
│   │   │   └── queue.ts             # BullMQ queues + Redis
│   │   ├── routes/
│   │   │   ├── health.ts
│   │   │   ├── projects.ts
│   │   │   ├── workflows.ts
│   │   │   ├── jobs.ts
│   │   │   ├── render.ts
│   │   │   └── webhooks.ts
│   │   ├── services/
│   │   │   ├── workflow-engine.ts
│   │   │   └── credit-manager.ts
│   │   ├── providers/                # AI provider abstraction
│   │   │   ├── base.ts
│   │   │   ├── image/
│   │   │   ├── video/
│   │   │   └── voice/
│   │   ├── workers/
│   │   │   └── video-worker.ts
│   │   └── utils/
│   │       └── security.ts
│   ├── tests/
│   ├── package.json
│   ├── tsconfig.json
│   └── Dockerfile
│
├── docker-compose.yml          # Self-hosted deployment
├── docker-compose.dev.yml      # Local development
├── .env.example
├── LICENSE
├── README.md
└── CLAUDE.md                   # This file
```

---

## Responsive Design

All pages are fully responsive and mobile-friendly.

### Dashboard Pages

- **Sidebar**: Collapses off-screen on mobile (<768px), revealed via hamburger menu with overlay backdrop
- **Mobile header**: Appears on small screens with hamburger button, logo, and theme toggle
- **Projects grid**: Adjusts from 3 columns (desktop) to 2 (tablet) to 1 (mobile)
- **Project detail**: Padding and font sizes scale down; settings button hidden on small screens

### Workflow Editor

- **Node toolbar**: Collapsible on mobile via floating action button (FAB) at bottom-left; always visible on desktop
- **Config panel**: Full-screen overlay on mobile; fixed 320px sidebar on desktop
- **Touch targets**: Node handles enlarge to 20px on touch devices (`@media(pointer:coarse)`) for easier connection dragging
- **Pinch to zoom**: Enabled via `zoomOnPinch` prop on ReactFlow; zoom range 0.2x-2x
- **MiniMap**: Hidden on mobile to save screen space
- **Editor toolbar**: Breadcrumbs hidden on small screens; button labels collapse to icon-only; workflow name input narrows

### Light/Dark Mode

Theme toggle (Sun/Moon icon) is accessible on every page:
- **Dashboard pages**: In the sidebar footer (desktop) and mobile header bar
- **Editor**: In the editor toolbar (top-right)
- Theme persists across sessions via `next-themes` with `class` attribute strategy

### Typography System

Professional font pairing for UI and data display:

| Usage | Font | Weight | Size |
|-------|------|--------|------|
| UI Text | Inter | 400-600 | 11-14px |
| Headings | Inter | 600-700 | 16-24px |
| Monospace (data, IDs, credits) | JetBrains Mono | 400-500 | 10-12px |
| Node labels | Inter | 600 | 11px uppercase |

**Google Fonts import** (in `globals.css`):
```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
```

### Light Mode Design

Clean, professional styling inspired by Stripe and Linear:

**Color Palette:**
| Element | Light Mode | Dark Mode |
|---------|------------|-----------|
| Background | #F8FAFC (slate-50) | #121212 |
| Card/Surface | #FFFFFF | #1E1E1E |
| Border | #E2E8F0 (gray-200) | #2D2D2D |
| Text Primary | #1E293B (slate-800) | #F8FAFC |
| Text Secondary | #64748B (slate-500) | #94A3B8 |
| Accent | #ff0073 | #ff0073 |

**Node Category Colors (Light Mode):**
| Category | Border | Header BG |
|----------|--------|-----------|
| Input | #E2E8F0 | #007AFF (blue) |
| Parameter | #EEF2FF | #6366F1 (indigo) |
| AI/Scene/Script | #404040 | #282828 (dark) |
| Processing | #CBD5E1 | #475569 (slate) |
| Character | #F9A8D4 | #EC4899 (pink) |
| Object | #6EE7B7 | #10B981 (emerald) |
| Location | #67E8F9 | #06B6D4 (cyan) |
| Output | #86EFAC | #22C55E (green) |

### Dark Mode Premium Styling

Glassmorphism and glow effects for a premium feel:

**Effects:**
- **Glassmorphism**: `backdrop-blur-sm` on cards and panels
- **Glow on selection**: Category-colored `box-shadow` when nodes are selected
- **Accent glow**: #ff0073 glow on AI/Scene nodes: `shadow-[0_0_20px_rgba(255,0,115,0.3)]`

**Node Glow Colors (when selected):**
```css
/* Dark mode selected node shadows */
input: shadow-[0_0_20px_rgba(56,189,248,0.4)]    /* sky-400 */
parameter: shadow-[0_0_20px_rgba(129,140,248,0.4)] /* indigo-400 */
ai/scene: shadow-[0_0_25px_rgba(255,0,115,0.5)]   /* brand pink */
processing: shadow-[0_0_20px_rgba(71,85,105,0.4)] /* slate-600 */
character: shadow-[0_0_20px_rgba(244,114,182,0.4)] /* pink-400 */
location: shadow-[0_0_20px_rgba(34,211,238,0.4)]  /* cyan-400 */
object: shadow-[0_0_20px_rgba(52,211,153,0.4)]    /* emerald-400 */
output: shadow-[0_0_20px_rgba(34,197,94,0.4)]     /* green-500 */
```

### Top Navigation Bar (Floating Tabs)

The editor features a floating tab bar that overlaps the header/canvas border:

**Tabs:**
- **Editor**: Main workflow canvas (Layers icon)
- **Executions**: Job history filtered by logged-in user (History icon)
- **Cost**: Credit usage placeholder (DollarSign icon)

**Styling:**
- **Container**: White bg (light) / #1E1E1E (dark), rounded-lg, subtle border
- **Active tab**: Underline indicator (`border-b-2 border-[#ff0073]`), pink text
- **Inactive tab**: Steel gray text (#64748B light / gray-400 dark)
- **Executions badge**: Pink rounded badge showing running job count

**Position**: Absolute positioned at `-top-5` with `left-1/2 -translate-x-1/2` for centered overlap

**Implementation**: `frontend/src/components/editor/workflow-editor.tsx`

### Executions Tab

User-specific execution history with real-time data:

**Features:**
- **User filtering**: Shows only jobs belonging to the logged-in user (via `userId` query param)
- **Pagination**: Cursor-based pagination with Previous/Next buttons
- **Auto-refresh**: Refresh button to fetch latest jobs
- **Job cards**: Show type, status badge, duration, cost estimate, relative time
- **Click to expand**: Opens Execution Detail Modal

**Status Badges:**
| Status | Light Mode | Dark Mode |
|--------|------------|-----------|
| Completed | green-100/green-700 | green-500/20 |
| Failed | red-100/red-700 | red-500/20 |
| Processing | yellow-100/yellow-700 | yellow-500/20 |
| Pending/Queued | blue-100/blue-700 | blue-500/20 |
| Cancelled | gray-100/gray-700 | gray-500/20 |

**Implementation**: `frontend/src/components/editor/executions-tab.tsx`

### Execution Detail Modal

Replicate-style two-column layout showing prediction details:

**Left Column (60%):**
- Output preview (image/video/audio player)
- Large preview area with media controls

**Right Column (40%):**
- **Status**: Badge with colored indicator
- **ID**: Monospace job ID with copy button
- **Type**: Job type (generate-image, generate-video, etc.)
- **Provider**: AI provider used
- **Duration**: Time taken (formatted)
- **Cost**: Estimated cost based on duration
- **Timestamps**: Created, started, completed times
- **Input Data**: Collapsible JSON viewer
- **Output Data**: Collapsible JSON viewer
- **Error Message**: Red alert if job failed

**Actions:**
- **Delete button**: Remove job from history (with confirmation)
- **Copy ID**: Copy job ID to clipboard

**Implementation**: `frontend/src/components/editor/execution-detail-modal.tsx`

### Cost Tab

Placeholder for credit usage analytics (coming soon):
- Shows "Credit usage analytics coming soon" message
- Displays DollarSign icon
- Background matches theme (light: #F8FAFC, dark: #121212)

**Implementation**: `frontend/src/components/editor/cost-tab.tsx`

### Breakpoints

| Breakpoint | Tailwind | Behavior |
|------------|----------|----------|
| <640px | default | Single column, icon-only buttons, collapsed sidebar |
| 640-767px | `sm:` | Wider inputs, text labels on buttons |
| 768px+ | `md:` | Sidebar visible, full breadcrumbs, MiniMap shown |
| 1024px+ | `lg:` | 3-column project grid |

### UI/UX Styling

**Accent Color**: `#ff0073` (pink) is the main accent color used throughout the entire application.

| Element | Color |
|---------|-------|
| Primary buttons (`variant="default"`) | #ff0073 |
| Save button (Unsaved/Saving/Saved states) | #ff0073 |
| Execute/Run buttons | #ff0073 |
| Sidebar section headers (INPUT, PARAMETER, etc.) | #ff0073 |
| Video autoplay toggle (when active) | #ff0073 |
| MiniMap toggle (when active) | #ff0073 fill |
| Canvas Controls active state | #ff0073/10 bg + #ff0073 text |

### Editor Toolbar (Top Bar)

The top toolbar in the workflow editor with navigation, save controls, and settings.

**Location**: `frontend/src/components/editor/editor-toolbar.tsx`

**Elements (left to right):**
- Back button (arrow left) - navigates to project
- Breadcrumbs: Project name > Workflow name (editable input)
- Save button with integrated states
- Video autoplay toggle
- Theme toggle (sun/moon)
- More menu (export/import)

**Save Button States:**

| State | Background | Icon | Text | Behavior |
|-------|------------|------|------|----------|
| Idle (no changes) | muted gray | CheckCircle | "Saved" | Disabled |
| Unsaved (dirty) | #ff0073 | Save | "Unsaved" | Enabled, clickable |
| Saving | #ff0073 | Loader2 (spinning) | "Saving..." | Disabled |
| Saved | #ff0073 | CheckCircle (green-300) | "Saved" | Shows for 1.5s, then returns to Idle |
| Error | red (#ef4444) | RefreshCw | "Retry" | Enabled, shows error on hover |

**Removed Components:**
- ~~Validate button~~ - Validation now happens automatically when executing workflow
- ~~Asterisk (*) unsaved indicator~~ - Replaced by integrated Save button states

**React Flow Attribution:**
- Hidden via `proOptions={{ hideAttribution: true }}` on ReactFlow component
- Located in `frontend/src/components/editor/workflow-canvas.tsx`

**Next.js Dev Indicator:**
- Hidden via `devIndicators: false` in `frontend/next.config.ts`
- Only affects development mode

**CSS Variables** (in `globals.css`):
```css
:root {
  --primary: #ff0073;
  --primary-foreground: #ffffff;
}
.dark {
  --primary: #ff0073;
  --primary-foreground: #ffffff;
}
```

### MiniMap Node Colors

The MiniMap shows each node in its actual category color (not a fixed color):

| Node Type | Color |
|-----------|-------|
| Character | #ec4899 (pink-500) |
| Object | #10b981 (emerald-500) |
| Location | #06b6d4 (cyan-500) |
| Scene | #8b5cf6 (violet-500) |
| AI nodes (generate-*, text-to-*, etc.) | #a855f7 (purple-500) |
| Input nodes | #3b82f6 (blue-500) |
| Parameter nodes | #6366f1 (indigo-500) |
| Processing nodes | #f59e0b (amber-500) |
| Output nodes | #22c55e (green-500) |
| Sticky notes | #fbbf24 (yellow-400) |

### Running Node Animation

When a node is executing, it shows a distinctive animated border:

**CSS Implementation** (in `globals.css`):
```css
.node-running {
  position: relative;
  border: 3px solid #3b82f6 !important; /* Blue base, 1.5x thicker */
  box-shadow: 0 0 8px rgba(59, 130, 246, 0.4);
}

.node-running::before {
  background: conic-gradient(
    from var(--gradient-angle, 0deg),
    #ff0073 0deg,
    #ff0073 90deg,
    transparent 90deg,
    transparent 360deg
  );
  animation: spin-border 1.5s linear infinite;
}
```

### Animated Edges with Flowing Dot

During workflow execution, edges from running nodes show animated data flow:

1. **Edge styling**: Pink (#ff0073) stroke with 2px width, dashed line animation
2. **Flowing dot**: Pink glowing circle (5px radius) that travels along the bezier path
3. **Implementation**: Custom `AnimatedFlowEdge` component using SVG `<animateMotion>`

**Location**: `frontend/src/components/editor/animated-flow-edge.tsx`

**Usage in workflow-canvas.tsx**:
```tsx
const edgeTypes = {
  default: AnimatedFlowEdge,
}

// Edges get isRunning data when source node is executing
const animatedEdges = edges.map((edge) => ({
  ...edge,
  data: { isRunning: runningNodeIds.has(edge.source) },
}))
```

### Node Resizing

All nodes are resizable using React Flow's `NodeResizer` component. Users can drag corners or edges to resize any node. Each node type has appropriate minimum dimensions defined in `BaseNode`.

### Canvas Toolbar

A vertical icon toolbar fixed on the left side of the canvas, providing quick access to common actions.

**Location**: `frontend/src/components/editor/canvas-toolbar.tsx`

**Buttons (top to bottom):**

| Icon | Label | Shortcut | Action |
|------|-------|----------|--------|
| Plus | Add Node | Tab | Opens Add Node popup |
| Search | Search | Ctrl+K | Opens Search modal (projects/workflows) |
| Package | Asset Library | Ctrl+L | Opens Asset Library modal |
| StickyNote | Add Sticky Note | Shift+S | Adds sticky note at center |
| Wand2 | Tidy Up | Alt+T | Auto-arranges nodes by type |
| PanelLeft | Toggle Sidebar | Ctrl+B | Shows/hides node toolbar sidebar |

**Styling:**
- Fixed position: left side, vertically centered
- Glassmorphism effect: backdrop blur with semi-transparent background
- Light mode: white/80 bg, subtle shadow, slate-200 shadow tint
- Dark mode: #1E1E1E/90 bg, deeper shadow, black/20 shadow tint
- Rounded corners (rounded-2xl)
- Each button shows tooltip with label and shortcut on hover
- Active state (for Toggle Sidebar) highlighted with pink (#ff0073)

**Tooltip Styling:**
- Light mode: white bg, #1E293B text, #E2E8F0 border, subtle shadow
- Dark mode: #2D2D2D bg, #E2E8F0 text, #3D3D3D border, deeper shadow
- Shortcut badge: #F1F5F9 bg (light) / #121212 bg (dark)

### Canvas Controls

A horizontal control bar at the bottom-left of the canvas for zoom and minimap controls.

**Location**: `frontend/src/components/editor/canvas-controls.tsx`

**Buttons:**

| Icon | Label | Action |
|------|-------|--------|
| Maximize2 | Fit to Screen | Fits all nodes in view with 0.2 padding |
| ZoomIn | Zoom In | Increases zoom level |
| ZoomOut | Zoom Out | Decreases zoom level |
| Map | Toggle MiniMap | Shows/hides the minimap (active state highlighted) |

**Styling:**
- Fixed position: bottom-left, offset from Canvas Toolbar (left-16)
- Glassmorphism: backdrop-blur with semi-transparent background
- Light mode: white/80 bg, #E2E8F0 border, subtle shadow
- Dark mode: #1E1E1E/90 bg, #2D2D2D border, deeper shadow
- Active state (MiniMap toggle): pink (#ff0073) background tint
- Hidden on mobile (< 768px)

### Add Node Popup

A centered popup for quickly adding nodes to the canvas with category navigation and search.

**Location**: `frontend/src/components/editor/add-node-popup.tsx`

**Features:**
- Header: "What do you want to create?"
- Search input with keyboard focus on open
- Category pills: INPUT, PARAMETER, AI, PROCESSING, ASSETS, OUTPUT
- Category-specific icon colors on hover
- Keyboard navigation: Arrow keys to navigate, Enter to select, Escape to close
- Click outside or Escape to dismiss

**Category Colors (hover):**

| Category | Color |
|----------|-------|
| Input | #007AFF (blue) |
| Parameter | #6366F1 (indigo) |
| AI | #ff0073 (pink) |
| Processing | #475569 (slate) |
| Assets | #8B5CF6 (violet) |
| Output | #22C55E (green) |

### Search Modal

A modal for searching user's projects and workflows, with results opening in new tabs.

**Location**: `frontend/src/components/editor/search-modal.tsx`

**Features:**
- Search input with debounced queries (300ms)
- Results grouped by type: Projects, Workflows
- Project results show folder icon (blue)
- Workflow results show git-branch icon (pink #ff0073)
- Click result or press Enter to open in new tab
- Keyboard navigation: Arrow up/down, Enter to open, Escape to close
- Footer shows keyboard hints

**URLs opened:**
- Projects: `/projects/{id}` (new tab)
- Workflows: `/projects/{projectId}/workflows/{id}` (new tab)

### Canvas Context Menu

Right-click context menu on the canvas for quick actions.

**Location**: `frontend/src/components/editor/canvas-context-menu.tsx`

**Menu items:**

| Item | Shortcut | Action |
|------|----------|--------|
| Add node | Tab | Opens Add Node popup at click position |
| Add sticky note | Shift+S | Adds sticky note at click position |
| Tidy up workflow | Alt+T | Auto-arranges all nodes |
| Select all | Ctrl+A | Selects all nodes |
| Clear selection | - | Deselects all nodes (disabled when no selection) |

**Styling:**
- Appears at mouse position (adjusted to stay on screen)
- White background (light) / #1E1E1E (dark)
- Keyboard shortcuts shown as styled badges
- Closes on click outside, scroll, or Escape

### Keyboard Shortcuts

Global keyboard shortcuts available in the workflow editor:

| Shortcut | Action |
|----------|--------|
| Tab | Open Add Node popup |
| Ctrl+K | Open Search modal (projects/workflows) |
| Ctrl+L | Open Asset Library modal |
| Shift+S | Add sticky note at center |
| Alt+T | Tidy up workflow (auto-arrange) |
| Ctrl+B | Toggle node toolbar sidebar |
| Ctrl+A | Select all nodes |
| Ctrl+D | Duplicate selected node |
| Delete | Delete selected node |
| Escape | Close popups/menus |

**Note:** Shortcuts are disabled when typing in inputs/textareas.

**Implementation**: Keyboard event listener in `frontend/src/components/editor/workflow-canvas.tsx`

### Node Toolbar Sidebar

The node toolbar sidebar is **hidden by default** and can be toggled via:
- Clicking the Toggle Sidebar button in the Canvas Toolbar
- Pressing Ctrl+B

**Location**: `frontend/src/components/editor/node-toolbar.tsx`

**Features:**
- Position: left side, offset to account for Canvas Toolbar (left-16)
- Shows Asset Library button at top
- Lists all node types organized by category
- Category-specific hover colors for icons
- Slide-in animation when shown
- Mobile: Shows as bottom sheet via FAB button

---

## Development Workflow

### Local Setup

```bash
# Clone
git clone https://github.com/scenenode/scenenode.git
cd scenenode

# Copy env
cp .env.example .env
# Fill in your API keys

# Start services
docker-compose -f docker-compose.dev.yml up -d

# Frontend
cd frontend
npm install
npm run dev

# Backend
cd backend
npm install
npm run dev

# Workers (in separate terminal)
npm run worker
```

### Testing

```bash
# Backend tests
cd backend
npm test

# Frontend tests
cd frontend
npm test

# E2E tests
npm run test:e2e
```

---

## Development Guidelines

### Testing Requirements

**Every piece of code must have tests.** No exceptions.

#### Backend (Node.js/Fastify)

```bash
# Run tests
cd backend
npm test

# Run with coverage
npm test -- --coverage
```

**Test structure:**
```
backend/
├── tests/
│   ├── unit/
│   │   ├── workflow-engine.test.ts
│   │   ├── credit-manager.test.ts
│   │   └── providers/
│   │       ├── nano-banana.test.ts
│   │       ├── veo.test.ts
│   │       └── elevenlabs.test.ts
│   ├── integration/
│   │   ├── api-projects.test.ts
│   │   ├── api-workflows.test.ts
│   │   ├── api-jobs.test.ts
│   │   └── api-render.test.ts
│   └── setup.ts              # Test fixtures
```

**What to test:**
| Component | Test Type | What to Verify |
|-----------|-----------|----------------|
| API endpoints | Integration | Status codes, response format, auth |
| Workflow engine | Unit | Node execution order, branching logic |
| Credit manager | Unit | Deduction, balance check, rollback |
| AI providers | Unit + Mock | Request format, response parsing, error handling |
| Job queue | Integration | Job creation, status updates, retries |

**Example test:**
```typescript
// tests/unit/credit-manager.test.ts
import { describe, it, expect } from "vitest"
import { estimateWorkflowCredits } from "../../src/services/credit-manager"

describe("estimateWorkflowCredits", () => {
  it("should calculate correct cost for workflow", () => {
    const nodes = [
      { type: "generate-script" },      // 2 credits
      { type: "generate-image" },        // 5 credits
      { type: "image-to-video" },        // 20 credits
    ]
    expect(estimateWorkflowCredits(nodes)).toBe(27)
  })

  it("should return 0 for free processing nodes", () => {
    const nodes = [
      { type: "adjust-volume" },
      { type: "trim-video" },
    ]
    expect(estimateWorkflowCredits(nodes)).toBe(0)
  })
})
```

#### Frontend (Next.js/React)

```bash
# Run tests
cd frontend
npm test

# Run with coverage
npm test -- --coverage
```

**Test structure:**
```
frontend/
├── __tests__/
│   ├── components/
│   │   ├── editor/
│   │   │   ├── Canvas.test.tsx
│   │   │   ├── NodePanel.test.tsx
│   │   │   └── PropertiesPanel.test.tsx
│   │   └── ui/
│   │       └── Button.test.tsx
│   ├── hooks/
│   │   ├── useWorkflow.test.ts
│   │   └── useCredits.test.ts
│   └── utils/
│       └── nodeValidation.test.ts
```

**What to test:**
| Component | Test Type | What to Verify |
|-----------|-----------|----------------|
| React components | Unit | Rendering, user interactions |
| Custom hooks | Unit | State changes, side effects |
| Utility functions | Unit | Input/output correctness |
| API calls | Integration | Request/response handling |

#### E2E Tests (Playwright)

```bash
npm run test:e2e
```

**Test structure:**
```
e2e/
├── tests/
│   ├── auth.spec.ts           # Login, signup, logout
│   ├── projects.spec.ts       # CRUD operations
│   ├── workflow-editor.spec.ts # Node drag, connect, configure
│   ├── job-execution.spec.ts  # Run workflow, track progress
│   └── billing.spec.ts        # Credits, subscription
```

**Critical E2E flows:**
1. User signs up → Creates project → Builds workflow → Runs → Gets video
2. User connects n8n → Sends request → Receives video URL
3. User runs out of credits → Sees error → Buys more → Continues

### Documentation Requirements

**Documentation must be updated with every feature.** Users should always know what they can do and how.

#### Documentation Structure

```
docs/
├── getting-started/
│   ├── quickstart.md          # 5-minute first video
│   ├── concepts.md            # Nodes, workflows, credits
│   └── ui-overview.md         # Editor walkthrough
│
├── nodes/
│   ├── input/
│   │   ├── text-prompt.md
│   │   ├── upload-image.md
│   │   └── upload-video.md
│   ├── ai/
│   │   ├── generate-script.md
│   │   ├── generate-image.md
│   │   ├── image-to-video.md
│   │   └── text-to-speech.md
│   ├── processing/
│   │   ├── combine-videos.md
│   │   ├── merge-video-audio.md
│   │   ├── extract-audio.md
│   │   ├── mix-audio.md
│   │   └── add-captions.md
│   └── output/
│       ├── save-to-storage.md
│       └── webhook.md
│
├── api/
│   ├── authentication.md
│   ├── endpoints.md
│   ├── webhooks.md
│   └── rate-limits.md
│
├── n8n/
│   ├── installation.md
│   ├── quick-render.md
│   ├── run-workflow.md
│   └── examples.md
│
├── self-hosting/
│   ├── docker-setup.md
│   ├── configuration.md
│   └── license.md
│
└── tutorials/
    ├── story-video.md         # Create a children's story
    ├── news-to-tiktok.md      # RSS to video automation
    ├── product-ad.md          # E-commerce video
    └── branching-endings.md   # Multiple video outputs
```

#### Node Documentation Template

Every node must have documentation following this template:

```markdown
# [Node Name]

## Overview
One sentence description of what this node does.

## When to Use
- Use case 1
- Use case 2

## Inputs
| Input | Type | Required | Description |
|-------|------|----------|-------------|
| prompt | string | Yes | The text prompt for generation |
| reference | image | No | Reference image for consistency |

## Outputs
| Output | Type | Description |
|--------|------|-------------|
| image | image | The generated image |

## Configuration
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| provider | select | Nano Banana | AI provider to use |
| style | select | - | Visual style preset |
| aspectRatio | select | 16:9 | Output aspect ratio |

## Credit Cost
X credits per execution.

## Examples

### Basic Usage
[Screenshot + explanation]

### With Reference Image
[Screenshot + explanation]

## Tips
- Tip 1 for better results
- Tip 2 for common issues

## Related Nodes
- [Generate Script](./generate-script.md)
- [Image to Video](./image-to-video.md)
```

#### API Documentation Template

```markdown
# [Endpoint Name]

## Endpoint
`POST /v1/render`

## Description
What this endpoint does.

## Authentication
Requires API key in header: `Authorization: Bearer sn_live_xxx`

## Request

### Headers
| Header | Required | Description |
|--------|----------|-------------|
| Authorization | Yes | Bearer token |
| Content-Type | Yes | application/json |

### Body
```json
{
  "text": "string (required)",
  "style": "string (optional)",
  "duration": "number (optional)"
}
```

### Parameters
| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| text | string | Yes | - | The story/content |
| style | string | No | "children" | Visual style |
| duration | number | No | 60 | Target duration in seconds |

## Response

### Success (200)
```json
{
  "job_id": "job_xxx",
  "status": "completed",
  "video_url": "https://..."
}
```

### Error (4xx/5xx)
```json
{
  "error": {
    "code": "insufficient_credits",
    "message": "You need 209 credits but only have 50"
  }
}
```

## Code Examples

### cURL
```bash
curl -X POST https://api.scenenode.ai/v1/render \
  -H "Authorization: Bearer sn_live_xxx" \
  -H "Content-Type: application/json" \
  -d '{"text": "A brave knight..."}'
```

### Python
```python
import requests

response = requests.post(
    "https://api.scenenode.ai/v1/render",
    headers={"Authorization": "Bearer sn_live_xxx"},
    json={"text": "A brave knight..."}
)
```

### JavaScript
```javascript
const response = await fetch("https://api.scenenode.ai/v1/render", {
  method: "POST",
  headers: {
    "Authorization": "Bearer sn_live_xxx",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({ text: "A brave knight..." })
});
```

## Rate Limits
See [Rate Limits](./rate-limits.md)
```

#### Documentation Rules

1. **Update on every PR** - If code changes, docs change
2. **Screenshots required** - For UI features, include screenshots
3. **Code examples required** - For API/SDK, include working examples
4. **Keep it simple** - User should understand in 30 seconds
5. **Version docs** - Major versions get separate docs

#### Live Documentation Updates (Claude Code)

**As Claude Code builds features, it MUST update documentation in real-time.**

| When Building... | Update These Docs |
|------------------|-------------------|
| Docker setup | `docs/self-hosting/docker-setup.md`, `README.md` |
| New Node | `docs/nodes/[category]/[node].md` |
| API endpoint | `docs/api/endpoints.md` |
| n8n Node | `docs/n8n/installation.md` |
| Environment variable | `docs/self-hosting/configuration.md`, `.env.example` |
| Database change | `docs/self-hosting/docker-setup.md` (migrations) |
| New feature | `CHANGELOG.md` |

**README.md must always have:**

```markdown
# SceneNode

## Quick Start (5 minutes)

### Option 1: Cloud (Recommended)
1. Go to https://scenenode.ai
2. Sign up
3. Create your first video

### Option 2: Self-Hosted (Docker)

#### Requirements
- Docker & Docker Compose
- 4GB RAM minimum
- API keys for: Gemini, ElevenLabs (optional)

#### Installation
\`\`\`bash
# Clone
git clone https://github.com/scenenode/scenenode.git
cd scenenode

# Configure
cp .env.example .env
# Edit .env with your API keys

# Run
docker-compose up -d

# Open
http://localhost:3000
\`\`\`

#### Getting API Keys
- **Gemini**: https://makersuite.google.com/app/apikey
- **ElevenLabs**: https://elevenlabs.io/api (optional, for voice)

## Documentation
- [Full Documentation](https://docs.scenenode.ai)
- [API Reference](https://docs.scenenode.ai/api)
- [n8n Integration](https://docs.scenenode.ai/n8n)

## License
Sustainable Use License - See [LICENSE](./LICENSE)
```

**Claude Code Workflow:**

```
1. Write code for feature
2. Write tests for feature
3. Update relevant docs
4. Update CHANGELOG.md
5. Commit all together
```

**Example - Adding a new node:**

```
Claude Code builds "Mix Audio" node:

1. Creates: backend/scenenode/nodes/mix_audio.py
2. Creates: backend/tests/unit/nodes/test_mix_audio.py
3. Creates: docs/nodes/processing/mix-audio.md
4. Updates: docs/nodes/README.md (add to list)
5. Updates: CHANGELOG.md
```

#### Changelog

Maintain a CHANGELOG.md:

```markdown
# Changelog

## [1.2.0] - 2026-02-15

### Added
- Mix Audio node for combining multiple audio tracks
- Extract Audio node for separating video and audio

### Changed
- Improved image generation speed by 30%

### Fixed
- Fixed webhook retry logic for failed deliveries

## [1.1.0] - 2026-02-01
...
```

---

## Technical Decisions

| Question | Decision | Reason |
|----------|----------|--------|
| UI Framework | shadcn/ui | Consistent design, good React Flow integration |
| State Management | React Query (server) + Zustand (UI) | Clear separation of concerns |
| Backend Language | TypeScript (Node.js) | Same language as frontend, BullMQ native support |
| Backend Framework | Fastify | Fast, TypeScript-first, great plugin system |
| Job Queue | BullMQ | Best-in-class for Node.js, excellent dashboard |
| Video Processing | FFmpeg in dedicated worker | Required for self-hosted edition |
| Realtime Updates | Polling (MVP) → SSE (Phase 2) | No additional infrastructure needed |
| Image Generation Model | google/nano-banana via Replicate | Good quality, supports reference images, internally uses flux-schnell |
| Video Generation Model | minimax/video-01 (default), google/veo-2 (VEO), google/veo-3 (VEO 3), google/veo-3.1 (VEO 3.1) via Replicate | MiniMax accepts first_frame_image; VEO 3 supports generate_audio toggle; VEO 3.1 supports first+last frame interpolation (4/6/8s duration only) |
| Asset Storage | Cloudflare R2 | S3-compatible, no egress fees, serves generated images and videos |
| Execution Model | Frontend DAG Engine | Topological sort, parallel execution per level, sequential between levels |
| Translation | google/gemini-2.5-flash via Replicate | Creative prompt translation (Hebrew, etc. to English) |
| Music Generation | MusicGen, MiniMax, Lyria, Bark via Replicate | Multiple providers with genre/mood control, provider switching |
| Audio Processing | FFmpeg (Merge Video & Audio, Extract, Mix, Adjust Volume) | All audio processing nodes use FFmpeg, not AI providers |
| Text to Audio | TangoFlux, Tango, AudioLDM, Bark via Replicate | Sound effects from text descriptions |
| TTS Model | elevenlabs/turbo-v2.5 via Replicate | 26 voice options, natural speech |
| AI Provider Abstraction | Replicate (default), KIE.ai (cloud) | Admin-configurable in cloud edition, transparent provider switching |

### AI Provider System

SceneNode supports multiple AI providers for image generation, with edition-based feature gating:

**Editions:**
- **Self-Hosted (EDITION=self-hosted)**: Always uses Replicate. No provider selection UI. Users pay Replicate directly.
- **Cloud (EDITION=cloud)**: Admin can choose between Replicate and KIE.ai. Cost markup applied. Provider details hidden from regular users.

**Provider Configuration:**
- Settings stored in `app_settings` table (key-value JSONB)
- Default: `ai_provider: "replicate"`, `***REDACTED-OSS-SCRUB***`
- Admin Settings page at `/admin/settings` (cloud edition only)

**KIE.ai Integration:**
- API docs: https://docs.kie.ai/
- Base URL: https://api.kie.ai
- Auth: Bearer token (KIE_API_KEY env var)
- Async task model:
  1. Submit: `POST /api/v1/jobs/createTask`
  2. Poll: `GET /api/v1/jobs/recordInfo?taskId=xxx`
- Cost estimation: KIE.ai doesn't return credits consumed, so we use fixed costs based on pricing page
- Model mapping: `nano-banana` → `google/nano-banana` (4 credits × $0.005 = $0.02)

**Cost Flow:**
```
API Response → provider_cost → (apply markup if CLOUD) → display_cost → Job Record
                    ↓                                                        ↓
              Stored in DB                                            Displayed in UI
```

**Privacy (Cloud Edition):**
- Regular users see only `cost` field (renamed from `display_cost`)
- `provider` and `provider_cost` fields hidden via `sanitizeJobForPublic()`
- Admin users see full cost breakdown

**Files:**
- `backend/src/services/kie-ai.ts` - KIE.ai API client
- `backend/src/lib/app-settings.ts` - Settings cache (5-minute TTL)
- `backend/src/routes/admin-settings.ts` - Admin settings CRUD
- `backend/src/routes/jobs.ts` - Response sanitization
- `frontend/src/app/(admin)/admin/settings/page.tsx` - Admin Settings UI

### Workflow Execution Engine

The workflow executor uses a DAG-based approach:

1. **Topological Sort** (`buildExecutionLevels`): Kahn's algorithm groups nodes into levels based on dependency depth. Level 0 = nodes with no incoming edges (Text Prompt, Upload Image). Level 1 = nodes depending only on Level 0 (Generate Image). Level 2+ = deeper dependencies.

2. **Parallel Execution**: All executable nodes within the same level run simultaneously via `Promise.allSettled()`. This means two Generate Image nodes at the same level start at the same time.

3. **Sequential Between Levels**: The engine waits for all nodes in a level to complete before starting the next level. If any node fails, execution stops.

4. **Input Resolution** (`resolveNodeInputs`): Before executing a node, the engine walks incoming edges to collect outputs from upstream nodes (prompt text, image URLs, video URLs, reference images).

5. **Reference Image Chaining**: When Generate Image nodes connect to another Generate Image node, all outputs are collected into a `referenceImageUrls` array (not a single URL). This array is passed to the Replicate API as `image_input`, which Nano Banana supports for up to 14 reference images. This enables character consistency when multiple characters from different scenes converge on a single scene (e.g., Knight from Scene 4 + Horse from Scene 3 both referenced in Scene 5).

6. **Executable Node Types**: Only `generate-image`, `image-to-video`, and `video-to-video` are executable. All other node types (input, parameter, processing) are data-only and read by downstream nodes.

### Character & Location Extraction

Users can extract visual references from generated scene images to maintain consistency across scenes.

**Types of References:**
- **Characters** - people, creatures, objects (e.g., Cucumber, Tomato, Hero)
- **Locations** - backgrounds, environments (e.g., Market, Beach, Castle)

**Selection Modes:**
- **Lasso** (default) - freeform drawing around irregular shapes, polygon crop with transparent background
- **Rectangle** - click+drag bounding box selection

**Workflow:**
1. Generate Script with characters tagged per scene
2. Generate Image for a scene
3. Click "Extract References" (Scissors icon) on the scene card
4. Toggle Lasso/Rect mode, draw selection around character/location
5. Name the extraction, set type (character/location), click Add
6. Cropped image is uploaded to R2 storage via `POST /v1/upload/image`
7. Character names from extractions appear in other scenes' character dropdown (with scissors icon)
8. Generate remaining scenes - extracted references are automatically passed as `image_input` to nano-banana

**Image Proxy (CORS):**
- Extract modal loads images via `GET /v1/image-proxy?url=<r2-url>` to avoid tainted canvas errors
- Proxy only allows URLs from the configured R2 bucket (security check)
- Image element uses `crossOrigin="anonymous"` with the proxied URL

**Reference Injection (two paths):**
1. **Storyboard modal** - `handleGenerateSceneImage` collects extracted refs matching scene's tagged characters and passes them as `referenceImageUrls` to the `generateImage` API call
2. **Expand to Nodes** - `handleExpandStoryboard` attaches `extractedReferenceUrls` to Generate Image node data, which `executeNode` reads and combines with chain references

**Data Structure:**
```typescript
interface ExtractedReference {
  id: string
  name: string
  type: 'character' | 'location'
  imageUrl: string       // R2 URL of cropped image
  sourceSceneIndex: number
  boundingBox: { x: number; y: number; width: number; height: number }
}
```

Stored on `GeneratedScript.extractedReferences`.

**Reference Priority in Expand to Nodes:**
1. Chain references (previous scene's full image via character-based edges)
2. Extracted references (cropped from specific scenes) - matched by character name

Both are combined into the `referenceImageUrls` array passed to Nano Banana as `image_input`.

### Character Definitions

Characters can be defined in two ways for visual consistency in Generate Image nodes:

**Definition Types:**
- **Reference Image** (`type: "reference"`) - uploaded image passed as `image_input` to provider
- **Text Description** (`type: "description"`) - appended to prompt: `"Include character '[name]': [description]."`

**Data Structure:**
```typescript
interface CharacterDefinition {
  id: string
  name: string
  type: 'reference' | 'description'
  category?: 'character' | 'location' | 'object'  // defaults to 'character' if undefined
  referenceImageUrl?: string
  description?: string
  sourceSceneIndex?: number
  importedFrom?: { workflowId: string; workflowName: string }
}
```

**Storage:** Workflow-level in Zustand store (`useWorkflowStore.characterDefinitions`). Persisted in `workflows.settings.characterDefinitions` JSONB. Generate Image nodes store only `characterDefinitionIds: string[]` referencing definitions by ID.

**Config Panel:** Generate Image nodes have an ASSETS section with:
- List of attached assets with category badges (blue=character ref, orange=character desc, cyan=location, emerald=object)
- Thumbnails shown for any asset with `referenceImageUrl` (not restricted to `type === "reference"`)
- "Add existing" dropdown for workflow-level assets not yet attached
- "Define new" button opens DefineCharacterModal for creating reference or description assets
- "Import Assets" button opens ImportAssetsModal (edit/delete current assets + import from other projects/workflows)
- `onImported` callback: when user imports assets via modal, IDs are auto-attached to the current node's `characterDefinitionIds`
- Assets can be edited by clicking on them (opens DefineCharacterModal in edit mode)

**Storyboard Modal:**
- All scene fields editable inline: action, visual description, dialogue, characters, mood, duration, image prompt (resizable textareas)
- Scene management: delete (inline confirmation), add new scene (+ card), drag-and-drop reorder (@dnd-kit with activator handle)
- Create Scene Node button per scene card
- Character input only allows selecting defined characters (no free-text tags)
- Typing filters dropdown; unmatched input shows "No character found. Define new" link
- "Define character" and "Manage" buttons on every scene card

**Import Assets Modal (`manage-characters-modal.tsx` / exported as `ImportAssetsModal`):**
- Filter tabs: All | Characters | Locations | Objects (filters both current assets and import candidates)
- Two sections: current workflow assets (edit/delete) + import from other projects/workflows
- Current assets shown as grid with thumbnails, category-aware type badges
- Edit button opens DefineCharacterModal in edit mode
- Delete button with inline confirmation
- Import via "Browse by project" (Project dropdown -> Workflow dropdown -> asset grid)
- Import via "Show all my assets" (flat list grouped by project, Supabase query with `projects(id, name)` join)
- Multi-select grid for import, skips duplicate names, preserves `category` field, adds `importedFrom` metadata
- `onImported` callback notifies parent component of newly imported asset IDs

**Character States:**
| State | What it has | Can reuse? |
|-------|-------------|------------|
| Description only | Text only | Can add to any scene, but generation blocked until earlier scene generates + saves reference |
| Reference only | Image only | Yes - available everywhere |
| Description + Reference | Text + Image | Yes - available everywhere |

**Character Flow:**
1. User defines description-only character, adds to scenes 1, 3, 5 (allowed with warning)
2. User tries to generate Scene 3 → BLOCKED: "Generate Scene 1 first and save reference for [name]"
3. User generates Scene 1 → Extract References modal auto-opens with message: "Save character references for consistent look in other scenes"
4. User selects/crops character → saves reference → character now has reference image
5. Scenes 3 and 5 can now generate

**Execution:**
- All asset types with `referenceImageUrl` added to `image_input` array (characters, locations, objects)
- Description assets: category-aware text appended to prompt ("Include character 'X': ...", "Include location 'Y': ...", "Include object 'Z': ...")
- Both storyboard path (`handleGenerateSceneImage`) and expanded node path (`executeNode`) support all asset categories
- Generation blocking: if a description-only char appears in an earlier scene, generation is blocked with error toast directing user to generate the earlier scene first
- After storyboard generation with description-only chars, ExtractReferencesModal auto-opens with suggested message
- Backend also accepts `characterDescriptions[]` in the generate-image route for direct API usage

**Visual Indicators:**
- Generate Image node: asset count badge ("N refs") when assets attached, always-visible scissors/delete buttons on generated images
- Storyboard character tags: orange background + FileText icon for description-only, purple background + ImageIcon for reference
- Config panel asset cards: category badges (cyan=location, emerald=object, blue=character ref, orange=character desc), "needs ref" label for description-only chars
- Dropdown suggestions: FileText (orange) for description-only, ImageIcon (blue) for reference

**Validation:**
- DefineCharacterModal disables Save button until name + type-specific content is provided
- DefineCharacterModal shows tip for description type: reference image needed for reuse
- Cannot create empty character tags in storyboard (must select from defined characters)

**Planned: Workflow Sharing (Hosted Version Only):**
- NOT available in self-hosted/open-source edition (Fair Code license model)
- Hosted version will add a "SHARED WITH ME" section in ImportAssetsModal import view
- Requires: `workflow_shares` table (sharer_id, recipient_id, workflow_id, permissions), sharing UI, license/version gating
- For now: users only see their own projects/workflows in import dropdown
- Self-hosted users: free, no sharing; Hosted users: collaboration features included in subscription

### Implementation Notes

**State Management:**
- React Query: workflows, jobs, projects, assets (anything from API)
- React Flow internal state: nodes, edges, viewport
- Zustand: selected node, panel visibility, wizard steps

**Video Workers:**
- Separate container from AI workers (CPU vs IO bound)
- Set concurrency limit (1-2 jobs per worker)
- Use `--threads` flag to cap FFmpeg CPU usage

**Realtime Updates (MVP):**
```typescript
useQuery({
  queryKey: ['job', jobId],
  queryFn: () => fetchJobStatus(jobId),
  refetchInterval: 3000,
  enabled: status !== 'completed' && status !== 'failed'
})
```

---

## Admin Panel

### Overview

Admin panel at `/admin` for platform management. Only accessible to users with `role` = `admin` or `super_admin` in the profiles table.

### Routes

| Route | Purpose |
|-------|---------|
| `/admin` | Dashboard with stats (total users, projects, workflows, jobs, credits used) |
| `/admin/users` | List all users with tier, credits, role, join date |
| `/admin/jobs` | List all jobs with status filter, user, workflow, credits |
| `/admin/usage` | Usage logs with action, provider, credits, user |

### Access Control

- **Middleware**: `/admin/*` routes check `profiles.role` in middleware; non-admins redirected to `/projects`
- **Client-side**: `useAuth()` hook exposes `role` and `isAdmin` boolean
- **RLS policies**: Admin users have SELECT access on all key tables (profiles, projects, workflows, jobs, usage_logs, assets)
- **Sidebar**: Admin link (Shield icon) only visible when `isAdmin` is true

### User Roles

| Role | Access |
|------|--------|
| `user` | Standard dashboard, own projects/workflows |
| `admin` | All of `user` + admin panel read access |
| `super_admin` | All of `admin` + future write operations |

---

## Phase 1 MVP Scope (Detailed Breakdown)

### Phase 1.1 - Foundation (3-4 days)
- [x] Database schema in Supabase (users, projects, workflows, jobs)
- [x] Auth with Supabase (Google OAuth / Gmail login)
- [x] Fastify boilerplate with basic endpoints
- [x] Next.js boilerplate with shadcn/ui
- [x] Project structure for both repos (scenenode, scenenode-website)

### Phase 1.2 - Editor (4-5 days)
- [x] React Flow canvas setup
- [x] Node types: All 28 node types implemented
- [x] Save/Load workflow to database
- [x] Workflow validation (warnings & errors before execution)
- [x] Node configuration panels with field mapping

### Phase 1.3 - Execution (5-7 days)
- [x] Redis + BullMQ setup
- [x] Workflow execution engine (chain: Text -> Image -> Video)
- [x] Replicate integration (google/nano-banana for images, minimax/video-01 for video)
- [x] Job progress tracking (polling)
- [x] Asset storage to Cloudflare R2
- [x] Error handling and basic retries
- [x] Generated results display in nodes with version history
- [x] Active result selection across multiple generations
- [x] Delete individual results from version history
- [x] Global video autoplay toggle in editor toolbar
- [x] Single-node execution (Run button per node, hanging tab style)
- [x] Floating Execute/Stop workflow buttons (bottom center)
- [x] Video to Video node (continuation/style reference via minimax/video-01)
- [x] DAG Execution Engine (topological sort with Kahn's algorithm)
- [x] Parallel execution at each level (Promise.allSettled)
- [x] Sequential execution with dependency waiting between levels
- [x] Reference image support (Image → Image chains via nano-banana)
- [x] Generate Script with storyboard preview (inline scene strip + full-screen modal)
- [x] Storyboard Modal: per-scene image generation, "Generate All Images" batch, version history per scene
- [x] Expand to Nodes: one-click storyboard → Generate Image + Image to Video per scene, optional Combine Videos, horizontal/vertical layout, auto-run, intelligent credit estimation
- [x] Generate Music node (MusicGen, MiniMax, Lyria, Bark providers with genre/mood/instrumental options)
- [x] Reference Audio node (YouTube URL preview, audio extraction, connects to Generate Music for MiniMax)
- [x] FFmpeg processing nodes: Merge Video & Audio (multi-track mixer), Extract Audio, Trim Video, Resize Video, Adjust Volume, Add Captions, Mix Audio
- [x] Delete confirmation dialog for all version history deletions
- [x] Text to Speech via elevenlabs/turbo-v2.5 (Replicate) with 26 voice options
- [x] Text to Video node
- [x] Text to Audio node (TangoFlux/Tango/AudioLDM/Bark) for sound effects generation
- [x] VEO 3 integration with generate_audio toggle for native AI audio
- [x] Renamed Add Audio to Merge Video & Audio for clarity
- [x] VEO 2 and VEO 3 as separate providers in Image to Video and Video to Video nodes
- [x] Generate Audio checkbox only shown when VEO 3 is selected (not VEO 2)
- [x] 37 node types total (Input: 5, Parameter: 8, AI: 9, Scene: 1, Character: 1, Object: 1, Location: 1, Processing: 8, Output: 2, Utility: 1)
- [x] Character & Location extraction from scene images (crop + upload to R2, used as references in Expand to Nodes)
- [x] Asset management system: characters, locations, objects with category-aware execution
- [x] Import Assets modal with project hierarchy, "Show all assets" mode, filter tabs (All/Characters/Locations/Objects)
- [x] Auto-attach imported assets to Generate Image nodes via onImported callback
- [x] Extract References (scissors) button always visible on generated images
- [x] Asset count badge on Generate Image nodes showing attached reference count
- [x] Scene Node: cinematic control center combining characters, locations, objects, cinematography, mood, dialogue into smart prompt
- [x] Scene Node: full-screen editor modal with two-panel layout (image preview + config)
- [x] Scene Node: 11 collapsible config sections (Basic Info, Characters, Dialogue, Locations, Objects, Cinematography, Mood & Style, Audio, Transitions, Aspect Ratio, Director Notes)
- [x] Scene Node: smart prompt builder with priority-based truncation (high/medium/low tiers, 2000 char limit)
- [x] Scene Node: "Create new..." option in all asset dropdowns (never disabled)
- [x] Scene Node: quick add by description, import from Manage Characters modal
- [x] Scene Node: 6 output handles (prompt, imageRefs, narration, dialogue, duration, input)
- [x] Scene Node: extract references from generated images, character count warning in prompt preview
- [x] Scene Editor: 4-step wizard (Story, Image, Audio, Video) with step indicators and navigation
- [x] Scene Editor: per-dialogue voice selection (26 ElevenLabs voices) with per-line TTS generation
- [x] Scene Editor: audio version history per dialogue line (append new versions, switch active, delete individual)
- [x] Scene Editor: "Generate All Audio" button processes all dialogue lines without audio sequentially
- [x] Scene Node: Script Connection - link to Generate Script node, select scene, import data (characters, dialogue, locations, cinematography, mood, images, prompts)
- [x] Scene Node: mapScriptSceneToNodeData() field mapping utility with full coverage (17 fields mapped)
- [x] Scene Node: Auto-sync toggle for automatic re-import when scene selection changes
- [x] Scene Node: Script title display (not node label) in dropdowns and modal header
- [x] Scene Node: Script Connection always visible regardless of wizard step (outside step filter)
- [x] Scene Node: SelectContent z-index fix (position=popper, z-[9999]) for modal rendering
- [x] Scene Node: 5 audio input handles (audio1-audio5) for connecting TTS/audio nodes
- [x] Scene Node: AudioAssignment data model mapping connected audio to dialogue lines
- [x] Scene Node: Connected Audio section in Step 3 with source node labels, assignment dropdowns, audio players
- [x] Scene Node: "Connected" badge on dialogue lines with assigned audio (connected audio priority over generated)
- [x] Scene Editor: Video generation in Step 4 with provider selection (minimax/veo/veo3/kling/runway/pika), duration, video prompt via buildVideoPrompt()
- [x] Scene Editor: Video player with controls in left panel, Image/Video tab toggle, video version history (thumbnails, delete, switch active)
- [x] Scene Editor: Generated Prompt accordion (Radix UI) with full untruncated display via buildScenePrompt({ forDisplay: true })
- [x] Scene Node: videoProvider, generatedVideoResults, activeVideoResultIndex, generatedVideoUrl, videoExecutionStatus fields
- [x] Generate Script: Editable storyboard preview (all scene fields are resizable textareas: action, visual description, dialogue, characters, mood, duration, image prompt)
- [x] Generate Script: Scene management - delete scene with inline confirmation (no dialog), add new scene (+ card at end of grid), drag-and-drop reorder via @dnd-kit
- [x] Generate Script: Create Scene Node from individual scene in storyboard modal
- [x] Generate Script: Expand to Nodes creates Scene Nodes (recommended) or Pipeline Nodes per scene
- [x] Character Node: generate main portrait (single front view) or upload from computer
- [x] Character Node: individual asset generation -- Angles (3: front/side/back), Expressions (6: neutral/smile/angry/surprised/sad/talking), Poses (4: standing/walking/sitting/running), Lighting (3: daylight/night/dramatic)
- [x] Character Node: sequential per-variant API calls with progressive UI updates (replaces sheet+split approach)
- [x] Character Node: collapsible asset sections with accordion UI, click-to-enlarge lightbox for all images
- [x] Character Node: version handling for duplicate names (auto-versioning on blur with data clearing)
- [x] Character Node: Run button on hover (delete only via Character Page modal)
- [x] Character Gallery: shows DB characters only, click thumbnail opens Character Page, "+" button adds to canvas
- [x] Character Gallery: "+" button always visible (can add same character multiple times)
- [x] Character Page modal: full-page modal with tabs (Main, Expressions, Poses, Lighting, Angles, Custom)
- [x] Character Page modal: "+" button on any image adds it to canvas as generate-image node with result pre-set
- [x] Character Page modal: dialogs close automatically after adding image to canvas
- [x] Image Lightbox: portal-based fullscreen image viewer (createPortal to document.body), Escape/click/X to close
- [x] Image upload: reuses POST /v1/upload/image endpoint for character reference images
- [x] Upload Image node: displays image thumbnail with enlarge button
- [x] Character DB persistence: characters saved to Supabase `characters` table on portrait generation, `characterDbId` stored in node data
- [x] Character DB persistence: duplicate node clears `characterDbId` (fresh unpersisted character)
- [x] Character DB persistence: delete node from canvas does NOT delete from database
- [x] Custom variation generation: free-form text prompt generates custom character images via `generate-character-asset` endpoint with `assetType: "custom"`
- [x] Delete individual assets: inline confirmation per image in Character Page modal
- [x] Delete character permanently: "Delete Forever" button in Character Page header, deletes from Supabase DB + removes node from canvas
- [x] Backend: GET /v1/characters (list by projectId), POST /v1/characters (upsert), DELETE /v1/characters/:id endpoints
- [x] Drag and drop character images to canvas: creates generate-image node at drop position with image as result
- [x] Character node as reference image: when Character node connected to Generate Image/Image to Video, only the main portrait is used as reference (not expressions/poses/lighting/angles/custom assets)
- [x] Multiple character references: connecting multiple Character nodes passes ALL main portraits as reference images for consistent multi-character scenes
- [x] Object Node: generate main object image (single front view) or upload from computer
- [x] Object Node: individual asset generation -- Angles (5: front/side/top/back/three-quarter), Materials (6: wood/metal/glass/plastic/fabric/stone), Variations (5: clean/weathered/damaged/ornate/minimal)
- [x] Object Node: sequential per-variant API calls with progressive UI updates
- [x] Object Node: collapsible asset sections with accordion UI, click-to-enlarge lightbox for all images
- [x] Object Node: Run button on hover (delete only via Object Page modal)
- [x] Object Gallery: shows DB objects only, click thumbnail opens Object Page, "+" button adds to canvas
- [x] Object Page modal: full-page modal with tabs (Main, Angles, Materials, Variations, Custom)
- [x] Object Page modal: "+" button on any image adds it to canvas as generate-image node with result pre-set
- [x] Custom variation generation: free-form text prompt generates custom object images via `generate-object-asset` endpoint with `assetType: "custom"`
- [x] Delete individual assets: inline confirmation per image in Object Page modal
- [x] Delete object permanently: "Delete Forever" button in Object Page header, deletes from Supabase DB + removes node from canvas
- [x] Backend: GET /v1/objects (list by projectId), POST /v1/objects (upsert), DELETE /v1/objects/:id endpoints
- [x] Backend: POST /v1/generate-object (main image), POST /v1/generate-object-asset (variants)
- [x] Object categories: furniture, vehicle, weapon, food, clothing, electronics, nature, tool, other
- [x] Object node as reference image: when Object node connected to Generate Image, the main image is used as reference
- [x] Multiple object references: connecting multiple Object nodes passes ALL main images as reference images
- [x] Location Node: generate main location image (single establishing shot) or upload from computer
- [x] Location Node: individual asset generation -- Time of Day (6: dawn/morning/noon/afternoon/dusk/night), Weather (6: clear/cloudy/rain/storm/snow/fog), Angles (5: wide/medium/closeup/aerial/low-angle)
- [x] Location Node: sequential per-variant API calls with progressive UI updates
- [x] Location Node: collapsible asset sections with accordion UI, click-to-enlarge lightbox for all images
- [x] Location Node: Run button on hover (delete only via Location Page modal)
- [x] Location Gallery: shows DB locations only, click thumbnail opens Location Page, "+" button adds to canvas
- [x] Location Page modal: full-page modal with tabs (Main, Time of Day, Weather, Angles, Custom)
- [x] Location Page modal: "+" button on any image adds it to canvas as generate-image node with result pre-set
- [x] Custom variation generation: free-form text prompt generates custom location images via `generate-location-asset` endpoint with `assetType: "custom"`
- [x] Delete individual assets: inline confirmation per image in Location Page modal
- [x] Delete location permanently: "Delete Forever" button in Location Page header, deletes from Supabase DB + removes node from canvas
- [x] Backend: GET /v1/locations (list by projectId), POST /v1/locations (upsert), DELETE /v1/locations/:id endpoints
- [x] Backend: POST /v1/generate-location (main image), POST /v1/generate-location-asset (variants)
- [x] Location categories: indoor, outdoor, urban, nature, fantasy, sci-fi, historical, futuristic
- [x] Location node as reference image: when Location node connected to Generate Image, the main image is used as reference
- [x] Multiple location references: connecting multiple Location nodes passes ALL main images as reference images
- [x] Cyan color theme for Location nodes (distinct from Character=pink, Object=emerald)
- [x] Refine feature: Character/Object/Location Page modals have "Refine" button to generate 4 cleaned-up variations
- [x] Refine picker: browse variations, view full-size in lightbox, select to replace main image
- [x] Refine saves to database: selected refined image updates database with userId preserved
- [x] Asset Library thumbnail refresh: thumbnails update automatically when Page modals close (300ms delay for DB propagation)
- [x] Unified Asset Library: shows ALL user assets across all projects with user_id filtering
- [x] VEO 3.1 support: first+last frame interpolation, duration restricted to 4/6/8 seconds dropdown
- [x] VEO 3.1 removed from Video to Video node (API doesn't support video input, only image input)
- [x] Image to Video node: single input handle accepts all connection types (images, audio)
- [x] Image to Video node: internal dropdowns for Start Frame, End Frame, Audio Track with thumbnail preview
- [x] Image to Video node: auto-select first connected image as Start Frame
- [x] Image to Video node: End Frame support for veo3.1, kling, runway, pika providers
- [x] Processing nodes store subscription: all 8 FFmpeg nodes now properly re-render after job completion
- [x] Trim Video fix: changed from `-c copy` (stream copy) to re-encoding (`-c:v libx264 -c:a aac`) for reliable output
- [x] Trim Video fix: uses input seeking (`-ss` before `-i`) with duration (`-t`) instead of absolute time (`-to`)
- [x] Content moderation error handling: E005 errors show user-friendly messages in Page modals
- [x] Asset Library fix: click thumbnail opens Page modal, click + button adds to canvas (sidebar and floating toolbar)
- [x] Asset Library fix: Page modals render outside library modal to avoid z-index issues
- [x] React hooks order fix: Page modals declare all hooks before conditional returns

### Phase 1.4 - Polish & Admin (5-7 days)

**User-facing:**
- [ ] Credit system (deduct on job completion)
- [ ] Overage handling (prompt to upgrade when credits run out)
- [ ] Dashboard with projects list
- [ ] Job history view
- [ ] Basic error messages and user feedback

**Admin Panel (`/admin/*` routes):**
- [ ] Admin middleware (check `user.role === 'admin'`)
- [ ] User management (list, search, view profile, add/remove credits, block user)
- [ ] Model management (enable/disable models, set credits cost per model)
- [ ] Plans & Pricing (define tiers, credits per tier - configurable)
- [ ] Monitoring (jobs queue status, recent errors, usage graphs)
- [ ] Revenue dashboard (from Paddle webhooks)

**Admin Panel Structure:**
```
app/
├── (main)/           # Main product
│   ├── dashboard/
│   ├── editor/
│   └── projects/
└── (admin)/          # Admin panel
    ├── users/
    ├── models/
    ├── billing/
    └── monitoring/
```

**Total: 18-23 working days**

After Phase 1.3 you have a working system that takes a workflow and outputs video.

---

### Phase 2 - API & Scale
- [ ] API access with API keys
- [ ] Webhooks
- [ ] More AI providers
- [ ] Templates library
- [ ] Team collaboration

### Phase 3+ - Enterprise
- [ ] Analytics
- [ ] SSO/SAML
- [ ] White-label
- [ ] Marketplace for templates

---

## Future Feature: Remotion Integration

Reference project: https://github.com/jhartquist/claude-remotion-kickstart

### What Remotion adds to SceneNode:

1. **Word-by-word captions** - Text highlighted word by word synced to voiceover (TikTok/Reels style)
2. **Complex transitions** - Fade, dissolve, wipe, zoom between scenes
3. **Text animations** - Flying text, lower thirds, After Effects-style titles
4. **Split screen / Picture-in-Picture** - Multiple videos on same screen
5. **Progress bars / Timers** - Dynamic elements that change over time
6. **Animated diagrams** - Mermaid/D2 diagrams that build step by step
7. **Code with typing effect** - Syntax highlighted code appearing line by line
8. **Ken Burns effect** - Zoom and pan on images
9. **Branding package** - Auto intro/outro, logo animations, watermarks
10. **Interactive templates** - Video story templates, presentation templates

### Architecture concept:
- SceneNode generates raw assets (AI images, videos, voiceover, music)
- Remotion does post-production (transitions, captions, animations, effects)
- Final render outputs professional video

### Components from remotion-kickstart:
- TitleSlide, ContentSlide, CodeSlide, DiagramSlide, VideoSlide
- Caption, Logo, Music overlays
- BRollVideo, ZoomableVideo, Screenshot, AsciiPlayer
- Presets: Landscape 720p/1080p, Square 1080p, Portrait 1080p

### Integration decisions needed:
- Where Remotion runs (backend server? cloud function?)
- UI for selecting effects/transitions (timeline? nodes?)
- How user configures captions, branding, templates

---

*Last updated: 2026-02-04*
*Version: 1.14.0*
