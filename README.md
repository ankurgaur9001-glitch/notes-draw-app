# Notes Draw App (Excalidraw-style MVP)

A lightweight whiteboard app inspired by Excalidraw, built with your own codebase (not embedding the full Excalidraw package).

## Implemented

- Excalidraw-style layout shell:
  - floating **top action bar**
  - **left tool rail** with shortcuts
  - **right properties panel**
  - **bottom HUD** for quick hints
- Infinite-feel canvas with **zoom** + **pan**
- Tools: **Select, Rectangle, Ellipse, Line, Arrow, Free Draw, Text**
- Keyboard shortcuts (V/H/R/O/L/A/P/T, undo/redo, delete, space-pan)
- Stroke / fill / stroke width controls
- Select + drag shapes
- Undo / redo
- Clear canvas
- Save / load drawing as JSON
- Export drawing as PNG
- Shareable links:
  - hosted short links via JSONBlob (`?blob=<id>`)
  - fallback encoded links (`?drawing=...`)
- Local autosave + restore

## Stack

- React + TypeScript + Vite
- react-konva + konva

## Run locally

```bash
npm install
npm run dev
```

Build:

```bash
npm run build
npm run preview
```

## Notes

- This is your custom implementation (not the full Excalidraw embed).
- Product roadmap: see `ROADMAP.md`.
