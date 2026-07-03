# Mobile App Shell for Published Apps

## Problem

The published app page (`/app/:slug`) currently stacks the desktop layout vertically on mobile with an overlay sidebar. This doesn't feel like a native mobile app — it's a responsive compromise that results in cramped controls, poor navigation, and no clear separation between inputs, outputs, and run history.

## Solution

A dedicated mobile layout (detected via `useIsMobile()`: `max-width: 899px` + `pointer: coarse`) that renders an entirely different component tree with a native-app feel: fixed header, bottom tab bar, and dedicated screens for inputs, outputs, and runs.

## Scope

- Only affects mobile viewport on the `/app/:slug` route (detected via existing `useIsMobile()` hook: `max-width: 899px` + `pointer: coarse`)
- Desktop layout is completely unchanged
- No backend changes
- No changes to state management (useAppRunnerStore, usePresentationStore, useRunSlots)

## Step 0: Prerequisite Refactor

Before building the mobile shell, extract shared rendering logic from `presentation-view.tsx` so both desktop and mobile can reuse it:

1. **Extract `InputCard`** (lines 1119-1225) → `frontend/src/components/presentation/input-card.tsx`
2. **Extract `OutputCard`** (lines 1228-1257) → `frontend/src/components/presentation/output-card.tsx`
3. **Extract `getCardTitle` helper** → move to `frontend/src/lib/presentation-utils.ts` (alongside existing `getNodeLabel`, `getNodeResult`, etc.)
4. **Do NOT extract `renderOutputCard` as a shared function** — it has closure dependencies on 5+ callbacks (`getResult`, `getNodeStatus`, `getCardTitle`, `handleOpenMedia`, `setConfigNode`). Instead, both `PresentationView` and `MobileAppShell` compose their own `renderOutputCard` from the shared primitives (`OutputCard`, `CONFIG_INPUT_TYPES`, `PlatformPreview`).
5. Update `presentation-view.tsx` to import from the new locations (functionality unchanged).

Note: `getCardTitle` should live in `frontend/src/components/presentation/helpers.ts` (not `presentation-utils.ts` which is a re-export file). It depends on `PresentationSettings.cardMeta` which is frontend-only.

This prerequisite refactor modifies `presentation-view.tsx` but does not change any behavior.

## Architecture

```
AppRunnerPage
├── Desktop (non-mobile): existing AppRunnerLayout + PresentationView (unchanged)
└── Mobile (useIsMobile() = true): MobileAppShell
    ├── MobileAppHeader (fixed top, 48px + safe-area-top)
    │   ├── Logo icon (links to /)
    │   ├── Truncated app name
    │   ├── Theme toggle
    │   └── Hamburger menu button → sheet dropdown
    ├── MobileAppContent (scrollable middle, height fills between header and tab bar)
    │   ├── InputsTab: ordered input cards + sticky Run button above tab bar
    │   ├── OutputsTab: ordered output cards with status badges
    │   └── RunsTab: run history list (authenticated users only)
    ├── MobileStickyAction (sticky above tab bar, 56px — Run/Stop/SignIn/GetCredits)
    └── MobileTabBar (fixed bottom, 56px + safe-area-bottom)
```

### Detection

Uses the existing `useIsMobile()` hook at `frontend/src/hooks/use-is-mobile.ts`. This hook uses `(max-width: 899px) and (pointer: coarse)` — the `pointer: coarse` check prevents desktop browsers resized narrow from false-triggering mobile mode. No new hook needed.

### Conditional Rendering in AppRunnerPage

```tsx
// app-runner-page.tsx
const isMobile = useIsMobile()

if (isMobile) {
  return <MobileAppShell slug={slug} app={app} user={user} runSlots={runSlots} />
}

return (
  <AppRunnerLayout ...>
    <PresentationView ... />
  </AppRunnerLayout>
)
```

## Components

### MobileAppHeader

Fixed top bar. Height: 48px + `var(--safe-area-top)`.

Layout:
```
┌─────────────────────────────────┐
│  [logo] App Name         [◑][☰]│
├─────────────────────────────────┤
│  ███████████░░░░░░  (progress)  │  ← 2px, only during execution
└─────────────────────────────────┘
```

- Logo: `NodaroLogo variant="icon" size="sm"`, links to `/`
- App name: `text-sm font-semibold truncate`
- Theme toggle: existing `<ThemeToggle />`
- Hamburger: lucide `Menu` icon, toggles sheet
- **All header buttons must be min 44x44px** touch targets with `touch-manipulation` class
- Progress bar: 2px tall, `bg-[#ff0073]`, width = `(completedNodes / totalNodes) * 100%`, CSS `transition: width 300ms ease`. Hidden when idle. On failure: changes to `bg-destructive` (red), fades out after 3 seconds.

#### Hamburger Menu Sheet

Slides down from header (not a sidebar). Rendered as an absolutely positioned panel below the header with backdrop overlay.

Contents (top to bottom):
1. **Credit balance** — `<CreditBalance>` (if logged in + `hasCredits()`)
2. **Divider**
3. **Run target selector** — sub-workflow picker (if workflow has sub-workflows)
4. **View mode selector** — for power users who want gallery/fullscreen/compare
5. **Version picker** — dropdown (if multiple versions)
6. **Divider**
7. **Remix** button (if `supportsRemix`)
8. **More Apps** — links to `/apps`
9. **Divider**
10. **Sign in / Sign out** — with user email shown when signed in

### MobileTabBar

Fixed bottom bar. Height: 56px + `var(--safe-area-bottom)`.

```
┌───────────┬───────────┬───────────┐
│  ✏ Input  │  ◻ Output │  ⏱ Runs  │
└───────────┴───────────┴───────────┘
```

- Each tab: icon (lucide) + label, stacked vertically, centered
- Active tab: `text-[#ff0073]` icon + label
- Inactive: `text-muted-foreground`
- Icons: `PenLine` (Inputs), `ImageIcon` or `Package` (Outputs), `Clock` (Runs)
- **Outputs badge**: Small dot or count badge (red/accent) when outputs have new results that haven't been viewed
- **Runs badge**: Muted count of total runs
- Runs tab only visible when `user` is truthy. When hidden, remaining 2 tabs split 50/50.
- Tab transitions: simple opacity/transform fade (no complex animation — keep it fast)

### MobileAppContent

Fills the space between header and tab bar: `calc(100dvh - header - tabbar - stickyAction?)`.

Each tab is a scrollable container. Only the active tab is mounted (no offscreen rendering — keeps memory low on mobile).

#### Inputs Tab

- Renders ordered input cards using existing `InputCard` component
- Uses same `orderedInputNodes` logic from PresentationView
- Cards rendered in a single column with `space-y-4` and `p-4`
- Passes same `presInputValues`, `presUpdateInput`, `readOnly` props

#### Outputs Tab

- Renders ordered output cards using the shared `renderOutputCard` function (extracted in Step 0)
- Handles all three rendering paths: social-media-format nodes (with `PlatformPreview`), config-type output nodes (with click-to-configure), and standard output cards (image/video/audio/text)
- Uses same `orderedOutputNodes`, `getResult`, `getNodeStatus`
- During execution: cards show existing `StatusBadge` + `ShimmerPlaceholder`
- **Empty state**: Centered illustration/text: "Run the app to see results" with subtle arrow icon. Shown when no outputs and not running.
- **Auto-switch**: On tap Run, immediately switch to Outputs tab so user sees shimmer/progress. If user navigates away during execution, auto-switch back when status transitions to "completed".

#### Runs Tab

- Renders `RunSlotItem` components in a flat scrollable list
- "New Run" button at top (full-width, accent color)
- Version picker dropdown below button (if `versions.length > 1`)
- Tap a run → calls `handleSelectSlot`, switches to Outputs tab to show that run's results
- Delete: existing context menu (long-press or kebab menu)

### MobileStickyAction

**Uses `position: fixed`** (not sticky) with `bottom: calc(56px + env(safe-area-inset-bottom))` to sit directly above the tab bar. Only visible on the **Inputs tab** when inputs are not read-only. Hidden when a text input is focused (see Keyboard Handling).

Height: 56px. Full-width with horizontal padding.

Layout: two buttons side by side:
```
┌─────────────────────────────────┐
│  [New Run]  [▶ Run (12 CR)]    │
└─────────────────────────────────┘
```

Left button (secondary, optional):
- "New Run" / "Retry" / "Clear" — matches existing `newRunLabel` logic
- Only shown when `onNewRun` is available

Right button (primary, full width if no left button):
- **Default**: "Run (N CR)" — pink accent, `Play` icon
- **Running**: "Stop" — red, `Loader2 spin` icon
- **Not authenticated**: "Sign in to Run" — pink, `LogIn` icon
- **Insufficient credits**: "Get Credits" — pink, `Sparkles` icon
- **Disabled**: when `allInputsFilled` is false — `opacity-50`

## State Management

The `MobileAppShell` manages one piece of local state: `activeTab: "inputs" | "outputs" | "runs"`.

All other state comes from existing hooks/stores:
- `useAppRunnerStore` — app data, execution status, cancel, `insufficientCredits`, `app?.supportsRemix` (accessed via `s.app?.supportsRemix ?? false`, not a top-level field)
- `usePresentationStore` — nodes, edges, node states, input values, run, estimatedCost, presentationSettings
- `useRunSlots` — run history, slot selection, CRUD
- `useAuth` — user, signOut
- `useUserCredits(user?.id)` — credit balance, tier (needed for `needsMoreCredits` check)

The `needsMoreCredits` derived value: `user && hasCredits() && userCredits && estimatedCost > 0 && userCredits.total < estimatedCost`.

The shell extracts the same derived values that `PresentationView` currently computes:
- `orderedInputNodes`, `orderedOutputNodes` (via `getInputNodes`, `getOutputNodes`, `orderNodesByIds`)
- `getNodeStatus`, `getResult` callbacks
- `isRunning`, `allInputsFilled`, `needsMoreCredits`
- `estimatedCost`, `costLabel`

These are computed in `MobileAppShell` and passed down to child components as props.

### Auto-tab-switch Logic

Two triggers for switching to the Outputs tab:

1. **Immediate on Run**: When user taps Run, switch to Outputs tab right away so they see shimmer/progress.
2. **On completion (if navigated away)**: If user moved to Inputs or Runs tab during execution, auto-switch back when status transitions to "completed".

```ts
// Inside MobileAppShell

// 1. Immediate switch on Run
const handleRun = useCallback(() => {
  // ... existing run logic (auth check, presRun(), etc.)
  setActiveTab("outputs")
}, [...])

// 2. Auto-switch on completion if user navigated away
const prevStatus = useRef(executionStatus)
useEffect(() => {
  if (prevStatus.current === "running" && executionStatus === "completed") {
    setActiveTab("outputs")
    setHasUnseenOutputs(false)
  }
  prevStatus.current = executionStatus
}, [executionStatus])
```

### Output Badge Logic

Merged into a single effect to prevent badge flicker from split state updates:

```ts
const [hasUnseenOutputs, setHasUnseenOutputs] = useState(false)

// Single effect handles both auto-switch and badge — prevents race condition
const prevStatus = useRef(executionStatus)
useEffect(() => {
  if (prevStatus.current === "running" && executionStatus === "completed") {
    // Auto-switch to outputs on completion (if user navigated away)
    setActiveTab("outputs")
    setHasUnseenOutputs(false)
  } else if (executionStatus === "completed" && activeTab !== "outputs") {
    // Badge when completed but user is on another tab
    setHasUnseenOutputs(true)
  }
  prevStatus.current = executionStatus
}, [executionStatus, activeTab])

// Clear badge when switching to outputs tab manually
useEffect(() => {
  if (activeTab === "outputs") setHasUnseenOutputs(false)
}, [activeTab])
```

## Execution Flow

1. User opens app on mobile → sees **Inputs tab** with input cards and Run button
2. Fills in inputs (text, uploads, parameters)
3. Taps **Run** → progress bar appears in header, button changes to "Stop", auto-switches to Outputs tab
4. Output cards show shimmer/spinner per node as execution proceeds
5. As nodes complete, output cards populate with results
6. On completion: progress bar fills to 100% and fades (300ms). Output badge clears.
7. Run appears in **Runs tab** for logged-in users
8. User can tap a previous run in Runs tab → loads that run's state, switches to Outputs tab

### Authentication on Mobile

When unauthenticated user taps "Sign in to Run", use the **redirect flow** (not popup). Mobile Safari aggressively blocks popups. Save current URL via `AUTH_REDIRECT_KEY` before navigating to `/login`. This matches the non-iframe branch of the existing `handleRunClick` logic.

### Modals in MobileAppShell

The shell's render tree must include:
- **`NodeConfigModal`** — for config-type input/output nodes that open a settings panel on click
- **`MediaPreviewModal`** — for fullscreen media lightbox when tapping output images/videos (with prev/next navigation)
- **`GetCreditsModal`** — for the "Get Credits" flow when `needsMoreCredits` or `insufficientCredits` is true
- **Delete confirmation `Dialog`** — for confirming run deletion (same as current `app-runner-page.tsx` lines 132-150)

## CSS / Styling

### New CSS in globals.css

```css
/* Mobile app shell safe area */
.mobile-app-header {
  padding-top: max(0.5rem, var(--safe-area-top, 0px));
}

.mobile-tab-bar {
  padding-bottom: max(0.25rem, var(--safe-area-bottom, 0px));
}

/* Progress bar animation */
.mobile-progress-bar {
  transition: width 300ms ease;
}

/* Menu sheet backdrop */
.mobile-menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
  background: rgba(0, 0, 0, 0.3);
}

.mobile-menu-sheet {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  z-index: 50;
  background: var(--card);
  border-bottom: 1px solid var(--border);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}
```

### Design Tokens

- Header height: 48px
- Tab bar height: 56px
- Sticky action height: 56px
- Active tab color: `#ff0073`
- Progress bar: `#ff0073`, 2px height
- All existing dark/light mode CSS variables apply

## Files

### New Files

| File | Purpose | Est. Lines |
|------|---------|------------|
| `frontend/src/components/presentation/input-card.tsx` | Extracted `InputCard` from presentation-view.tsx (Step 0) | ~120 |
| `frontend/src/components/presentation/output-card.tsx` | Extracted `OutputCard` + render logic from presentation-view.tsx (Step 0) | ~120 |
| `frontend/src/components/presentation/helpers.ts` | `getCardTitle(node, cardMeta)` helper (Step 0) | ~15 |
| `frontend/src/components/app-runner/mobile-app-shell.tsx` | Main mobile orchestrator: state derivation, tab switching, auto-switch, modals | ~450 |
| `frontend/src/components/app-runner/mobile-app-header.tsx` | Fixed header + progress bar + hamburger menu sheet | ~150 |
| `frontend/src/components/app-runner/mobile-tab-bar.tsx` | Bottom tab bar with badges | ~80 |
| `frontend/src/components/app-runner/mobile-sticky-action.tsx` | Sticky Run/Stop/SignIn button bar | ~100 |

### Modified Files

| File | Change |
|------|--------|
| `frontend/src/components/presentation/presentation-view.tsx` | Step 0: extract InputCard, OutputCard, getCardTitle; import from new files. No behavior change. |
| `frontend/src/routes/app-runner-page.tsx` | Import `useIsMobile` + `MobileAppShell`, conditional render; hoist delete dialog above mobile/desktop branch |
| `frontend/src/globals.css` | Add mobile shell CSS classes + `pointer: coarse` override for always-visible output card actions |
| `frontend/src/components/app-runner/index.ts` | Export new mobile components |

### No Changes To

- All individual input/output card components (text-input-card, image-upload-card, etc.) — reused as-is
- `useAppRunnerStore`, `usePresentationStore`, `useRunSlots` — consumed as-is
- `use-is-mobile.ts` — existing hook used as-is
- Backend — zero changes
- Any other routes or pages

## Mobile-Specific UX

### Keyboard Handling

On iOS Safari, `position: fixed` elements misbehave when the virtual keyboard opens. Strategy:
- Detect input focus via `focusin`/`focusout` events on the content area
- When an input is focused: **hide** `MobileStickyAction` and `MobileTabBar` (they slide out of view)
- When input blurs: restore both bars
- This prevents the bars from floating mid-screen on iOS

### File Upload on Mobile

The existing `FileDropZone` component uses drag-and-drop + click-to-open-picker. Drag-and-drop does not work on mobile. The click-to-open path works fine, but:
- Replace "Drop image here" text with "Tap to upload" when `useIsMobile()` is true (or based on `pointer: coarse`)
- The file picker on iOS/Android natively offers camera capture — no `capture` attribute needed for the general case
- Upload progress indicators work as-is (the `UploadSpinner` component)

### Output Media Actions on Mobile

Desktop output cards use hover overlays (`GlassButton` with `opacity-0 group-hover:opacity-100`) for download/fullscreen. Hover doesn't exist on mobile. Strategy:
- On mobile (detected via `pointer: coarse`), always show action buttons on output cards (remove hover gate)
- Use `@media (pointer: coarse) { .group-hover\\:opacity-100 { opacity: 1; } }` CSS override
- This ensures download, fullscreen, and copy URL buttons are always visible on touch devices

### Failed Output Cards

When a node fails during execution, the output card should display:
- The `StatusBadge` with "failed" state (existing component)
- The error message from `nodeStates[nodeId].error` if available, as small red text below the status badge
- No retry button at the individual card level — user retries via the Run button

### Deep-Linking on Mobile

The `?run=<runId>` query param works on mobile: on load, `useRunSlots` selects that run, and the mobile shell starts on the Outputs tab (since a specific run was requested). The `?sidebar=` param is ignored on mobile (no sidebar).

### Delete Confirmation Dialog

Hoisted to `app-runner-page.tsx` above the `isMobile` conditional branch, shared by both desktop and mobile layouts. This avoids duplication.

## Edge Cases

- **No inputs**: Inputs tab still shown but empty with "This app runs automatically" message. Run button still visible.
- **No outputs**: Outputs tab shows empty state until execution completes.
- **Single output**: Outputs tab shows one card, full width.
- **Many inputs/outputs**: Scrollable, no pagination needed.
- **Anonymous user**: Runs tab hidden, 2-tab layout. "Sign in to Run" on action bar.
- **Read-only mode** (viewing a past run): Sticky action bar hidden, inputs shown read-only.
- **Execution failure**: Progress bar turns red, error toast appears, per-card error messages shown.
- **Network error**: Same as execution failure — toast with error message. Inline error on Outputs tab if request failed before execution started.
- **Orientation change**: `useIsMobile` hook reacts to matchMedia changes — if user rotates to landscape on a tablet wider than 899px, switches to desktop layout.
- **iOS Safari**: Safe area insets via `env(safe-area-inset-*)`, `100dvh` for dynamic viewport height.
- **Keyboard open**: `MobileStickyAction` and `MobileTabBar` hide when input is focused (see Keyboard Handling section).
- **Deep-link with `?run=`**: Auto-selects run, opens on Outputs tab. `?sidebar=` ignored on mobile.
- **Scroll position**: Save `scrollTop` to a ref on tab unmount, restore on remount (prevents scroll loss on tab switch).
