# Notes Draw App — Excalidraw Parity Roadmap

Goal: Build an Excalidraw-style product with your own codebase, feature parity, and better UX.

## Phase 1 — UI Parity Shell (in progress)

- [x] Floating top action bar
- [x] Left tool rail with shortcuts
- [x] Right properties panel
- [x] Bottom quick-hint HUD
- [x] Keyboard-first flow (tool shortcuts, undo/redo, space-pan)
- [x] Scene autosave recovery
- [x] Share flow with hosted scene links

## Phase 2 — Editing Parity (next)

- [ ] Resize + rotate handles
- [ ] Multi-select (drag box, shift-select)
- [ ] Group / ungroup
- [ ] Duplicate and align actions
- [ ] Layer ordering (forward/back)
- [ ] Better text editing UX (inline editing)
- [ ] Sticky notes / diamond / image element

## Phase 3 — Files & Reliability

- [x] Scene versioning + migration guard
- [x] Robust import validation (Zod)
- [x] Safer export pipeline (PNG/SVG)
- [x] Crash-safe session restore (Stage state)

## Phase 4 — Collaboration

- [x] Realtime room sessions (Yjs + WebRTC)
- [x] Presence cursors
- [x] Conflict-safe sync (CRDT)
- [x] IndexedDB persistence for offline-first support

## Phase 5 — Better UX than baseline

- [ ] Command palette (Ctrl/Cmd + K)
- [ ] Smart snapping + spacing guides
- [ ] Mobile touch-first interactions
- [ ] Performance tuning for large scenes
- [ ] Polished onboarding + first-run tips
