# Notes Draw App (Excalidraw-style MVP)

A lightweight whiteboard app inspired by Excalidraw, built with your own codebase (not embedding the full Excalidraw package).

## Implemented (v1)

- Infinite-feel canvas with **zoom** (mouse wheel) and **pan** (Pan tool)
- Tools: **Select, Rectangle, Ellipse, Line, Arrow, Free Draw, Text**
- Stroke / fill / stroke width controls
- Select + drag shapes
- Undo / redo
- Clear canvas
- Save / load drawing as JSON
- Export drawing as PNG
- Generate **share link** that encodes the current drawing in URL

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

- This is an MVP foundation for a fuller Excalidraw-like app.
- Next steps can include: resize handles, multi-select, keyboard shortcuts, better text editing, and real-time collaboration.
