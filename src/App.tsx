import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { Layer, Stage, Text, Shape as KonvaShape } from 'react-konva'
import type Konva from 'konva'
import rough from 'roughjs'
import {
  ArrowRight,
  Circle as CircleIcon,
  Download,
  Hand,
  ImageDown,
  Minus,
  MousePointer2,
  Pencil,
  Redo2,
  Share2,
  Square,
  Trash2,
  Type,
  Undo2,
  Upload,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import './index.css'

type Tool = 'select' | 'pan' | 'rect' | 'ellipse' | 'line' | 'arrow' | 'draw' | 'text'

type ShapeBase = {
  id: string
  stroke: string
  fill: string
  strokeWidth: number
  roughness: number
}

type RectShape = ShapeBase & { type: 'rect'; x: number; y: number; width: number; height: number }
type EllipseShape = ShapeBase & { type: 'ellipse'; x: number; y: number; radiusX: number; radiusY: number }
type LineShape = ShapeBase & { type: 'line' | 'arrow'; points: number[] }
type DrawShape = ShapeBase & { type: 'draw'; points: number[] }
type TextShape = ShapeBase & { type: 'text'; x: number; y: number; text: string; fontSize: number }

type Shape = RectShape | EllipseShape | LineShape | DrawShape | TextShape

type ToolDefinition = {
  id: Tool
  label: string
  shortcut: string
  icon: LucideIcon
}

const TOOL_DEFINITIONS: ToolDefinition[] = [
  { id: 'select', label: 'Select', shortcut: 'V', icon: MousePointer2 },
  { id: 'pan', label: 'Hand', shortcut: 'H', icon: Hand },
  { id: 'rect', label: 'Rectangle', shortcut: 'R', icon: Square },
  { id: 'ellipse', label: 'Ellipse', shortcut: 'O', icon: CircleIcon },
  { id: 'line', label: 'Line', shortcut: 'L', icon: Minus },
  { id: 'arrow', label: 'Arrow', shortcut: 'A', icon: ArrowRight },
  { id: 'draw', label: 'Pencil', shortcut: 'P', icon: Pencil },
  { id: 'text', label: 'Text', shortcut: 'T', icon: Type },
]

const SNAPSHOT_LIMIT = 100
const LOCAL_SCENE_KEY = 'notes-draw-app.scene.v2'
const JSONBLOB_ENDPOINT = 'https://jsonblob.com/api/jsonBlob'

const generator = rough.generator()

const uid = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`

const encodeDrawing = (input: Shape[]) => btoa(unescape(encodeURIComponent(JSON.stringify(input))))
const decodeDrawing = (input: string) => JSON.parse(decodeURIComponent(escape(atob(input)))) as Shape[]

const clampScale = (value: number) => Math.max(0.2, Math.min(4, value))

export default function App() {
  const [tool, setTool] = useState<Tool>('select')
  const [spacePan, setSpacePan] = useState(false)
  const [stroke, setStroke] = useState('#111827')
  const [fill, setFill] = useState('#00000000')
  const [strokeWidth, setStrokeWidth] = useState(2)
  const [roughness, setRoughness] = useState(1)
  const [shapes, setShapes] = useState<Shape[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [history, setHistory] = useState<Shape[][]>([])
  const [redoStack, setRedoStack] = useState<Shape[][]>([])
  const [stageScale, setStageScale] = useState(1)
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 })
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight })
  const [shareState, setShareState] = useState<'idle' | 'publishing' | 'copied' | 'failed'>('idle')

  const stageRef = useRef<Konva.Stage | null>(null)
  const draftRef = useRef<Shape | null>(null)
  const drawSnapshotRef = useRef<Shape[] | null>(null)
  const dragSnapshotRef = useRef<Shape[] | null>(null)

  const activeTool = spacePan ? 'pan' : tool
  const selectedShape = useMemo(() => shapes.find((shape) => shape.id === selectedId) ?? null, [selectedId, shapes])

  useEffect(() => {
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    const loadScene = async () => {
      try {
        const params = new URLSearchParams(window.location.search)
        const blobId = params.get('blob')

        if (blobId) {
          const response = await fetch(`${JSONBLOB_ENDPOINT}/${blobId}`)
          if (response.ok) {
            const payload = (await response.json()) as Shape[]
            if (Array.isArray(payload)) {
              setShapes(payload)
              return
            }
          }
        }

        const encoded = params.get('drawing')
        if (encoded) {
          const parsed = decodeDrawing(encoded)
          if (Array.isArray(parsed)) {
            setShapes(parsed)
            return
          }
        }

        const localScene = localStorage.getItem(LOCAL_SCENE_KEY)
        if (localScene) {
          const parsed = JSON.parse(localScene) as Shape[]
          if (Array.isArray(parsed)) setShapes(parsed)
        }
      } catch (error) {
        console.error('Failed to hydrate scene', error)
      }
    }

    void loadScene()
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(LOCAL_SCENE_KEY, JSON.stringify(shapes))
    } catch (error) {
      console.error('Autosave failed', error)
    }
  }, [shapes])

  const pushUndoState = (previousScene: Shape[]) => {
    setHistory((prev) => [...prev.slice(-SNAPSHOT_LIMIT + 1), previousScene])
    setRedoStack([])
  }

  const commitScene = (nextScene: Shape[], previousScene: Shape[] = shapes) => {
    pushUndoState(previousScene)
    setShapes(nextScene)
  }

  const pointerToCanvas = (stage: Konva.Stage) => {
    const pointer = stage.getPointerPosition()
    if (!pointer) return null

    return {
      x: (pointer.x - stagePos.x) / stageScale,
      y: (pointer.y - stagePos.y) / stageScale,
    }
  }

  const setZoomAroundPoint = (nextScale: number, pivot: { x: number; y: number }) => {
    const oldScale = stageScale
    const limitedScale = clampScale(nextScale)

    const mousePointTo = {
      x: (pivot.x - stagePos.x) / oldScale,
      y: (pivot.y - stagePos.y) / oldScale,
    }

    setStageScale(limitedScale)
    setStagePos({
      x: pivot.x - mousePointTo.x * limitedScale,
      y: pivot.y - mousePointTo.y * limitedScale,
    })
  }

  const zoomByStep = useCallback((direction: 1 | -1) => {
    setZoomAroundPoint(stageScale + direction * 0.1, {
      x: viewport.width / 2,
      y: viewport.height / 2,
    })
  }, [stageScale, stagePos, viewport])

  const handleMouseDown = () => {
    const stage = stageRef.current
    if (!stage) return

    const p = pointerToCanvas(stage)
    if (!p) return

    if (activeTool === 'select') {
      const pointer = stage.getPointerPosition()
      const clickedOnEmpty = !pointer || stage.getIntersection(pointer) == null
      if (clickedOnEmpty) setSelectedId(null)
      return
    }

    if (activeTool === 'text') {
      const text = prompt('Enter text')
      if (!text) return

      const nextScene: Shape[] = [
        ...shapes,
        {
          id: uid(),
          type: 'text',
          x: p.x,
          y: p.y,
          text,
          fontSize: 24,
          stroke,
          fill: '#00000000',
          strokeWidth,
          roughness,
        },
      ]

      commitScene(nextScene)
      return
    }

    if (activeTool === 'pan') return

    drawSnapshotRef.current = shapes
    setIsDrawing(true)

    const id = uid()

    if (activeTool === 'rect') {
      draftRef.current = { id, type: 'rect', x: p.x, y: p.y, width: 1, height: 1, stroke, fill, strokeWidth, roughness }
    }

    if (activeTool === 'ellipse') {
      draftRef.current = { id, type: 'ellipse', x: p.x, y: p.y, radiusX: 1, radiusY: 1, stroke, fill, strokeWidth, roughness }
    }

    if (activeTool === 'line') {
      draftRef.current = { id, type: 'line', points: [p.x, p.y, p.x, p.y], stroke, fill, strokeWidth, roughness }
    }

    if (activeTool === 'arrow') {
      draftRef.current = { id, type: 'arrow', points: [p.x, p.y, p.x, p.y], stroke, fill, strokeWidth, roughness }
    }

    if (activeTool === 'draw') {
      draftRef.current = { id, type: 'draw', points: [p.x, p.y], stroke, fill: '#00000000', strokeWidth, roughness }
    }

    if (draftRef.current) {
      setShapes((prev) => [...prev, draftRef.current as Shape])
    }
  }

  const handleMouseMove = () => {
    if (!isDrawing || !draftRef.current) return

    const stage = stageRef.current
    if (!stage) return

    const p = pointerToCanvas(stage)
    if (!p) return

    setShapes((prev) => {
      const next = [...prev]
      const idx = next.findIndex((shape) => shape.id === draftRef.current?.id)
      if (idx < 0) return prev

      const shape = next[idx]

      if (shape.type === 'rect') {
        next[idx] = { ...shape, width: p.x - shape.x, height: p.y - shape.y }
      } else if (shape.type === 'ellipse') {
        next[idx] = {
          ...shape,
          radiusX: Math.abs(p.x - shape.x),
          radiusY: Math.abs(p.y - shape.y),
        }
      } else if (shape.type === 'line' || shape.type === 'arrow') {
        next[idx] = {
          ...shape,
          points: [shape.points[0], shape.points[1], p.x, p.y],
        }
      } else if (shape.type === 'draw') {
        next[idx] = {
          ...shape,
          points: [...shape.points, p.x, p.y],
        }
      }

      draftRef.current = next[idx]
      return next
    })
  }

  const handleMouseUp = () => {
    if (!isDrawing) return

    setIsDrawing(false)

    setShapes((prev) =>
      prev.map((shape) => {
        if (shape.id !== draftRef.current?.id) return shape

        if (shape.type === 'rect') {
          const normalizedWidth = Math.abs(shape.width)
          const normalizedHeight = Math.abs(shape.height)
          return {
            ...shape,
            x: shape.width < 0 ? shape.x + shape.width : shape.x,
            y: shape.height < 0 ? shape.y + shape.height : shape.y,
            width: normalizedWidth,
            height: normalizedHeight,
          }
        }

        return shape
      }),
    )

    if (drawSnapshotRef.current) {
      pushUndoState(drawSnapshotRef.current)
    }

    drawSnapshotRef.current = null
    draftRef.current = null
  }

  const updateShape = (id: string, updater: (shape: Shape) => Shape) => {
    setShapes((prev) => prev.map((shape) => (shape.id === id ? updater(shape) : shape)))
  }

  const undo = useCallback(() => {
    if (!history.length) return

    const previousScene = history[history.length - 1]
    setRedoStack((prev) => [shapes, ...prev].slice(0, SNAPSHOT_LIMIT))
    setHistory((prev) => prev.slice(0, -1))
    setShapes(previousScene)
    setSelectedId(null)
  }, [history, shapes])

  const redo = useCallback(() => {
    if (!redoStack.length) return

    const nextScene = redoStack[0]
    setHistory((prev) => [...prev.slice(-SNAPSHOT_LIMIT + 1), shapes])
    setRedoStack((prev) => prev.slice(1))
    setShapes(nextScene)
    setSelectedId(null)
  }, [redoStack, shapes])

  const removeSelected = useCallback(() => {
    if (!selectedId) return
    commitScene(shapes.filter((shape) => shape.id !== selectedId))
    setSelectedId(null)
  }, [selectedId, shapes])

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(shapes, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'drawing.json'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const importJson = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      const content = await file.text()
      const parsed = JSON.parse(content) as Shape[]
      if (!Array.isArray(parsed)) return
      commitScene(parsed)
      setSelectedId(null)
    } catch (error) {
      console.error('Failed to import JSON', error)
      alert('Invalid JSON file')
    } finally {
      event.target.value = ''
    }
  }

  const exportPng = () => {
    const dataUrl = stageRef.current?.toDataURL({ pixelRatio: 2 })
    if (!dataUrl) return

    const anchor = document.createElement('a')
    anchor.href = dataUrl
    anchor.download = 'drawing.png'
    anchor.click()
  }

  const copyText = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      return true
    } catch {
      window.prompt('Copy this link:', value)
      return false
    }
  }

  const shareDrawing = async () => {
    try {
      setShareState('publishing')

      const response = await fetch(JSONBLOB_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(shapes),
      })

      if (!response.ok) throw new Error(`Share publish failed: ${response.status}`)

      const location = response.headers.get('Location')
      const blobId = location?.split('/').pop()

      if (!blobId) throw new Error('Missing blob id')

      const shareUrl = `${window.location.origin}${window.location.pathname}?blob=${blobId}`

      if (navigator.share && window.innerWidth < 900) {
        await navigator.share({
          title: 'Notes Draw App scene',
          text: 'Open this drawing',
          url: shareUrl,
        })
      } else {
        await copyText(shareUrl)
      }

      setShareState('copied')
      window.setTimeout(() => setShareState('idle'), 2200)
    } catch (error) {
      console.error(error)
      const fallback = `${window.location.origin}${window.location.pathname}?drawing=${encodeURIComponent(
        encodeDrawing(shapes),
      )}`
      await copyText(fallback)
      setShareState('failed')
      window.setTimeout(() => setShareState('idle'), 2500)
    }
  }

  const clearAll = () => {
    if (!shapes.length) return
    commitScene([])
    setSelectedId(null)
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const isTyping = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable
      if (isTyping) return

      if (event.code === 'Space') {
        event.preventDefault()
        setSpacePan(true)
        return
      }

      const key = event.key.toLowerCase()
      const isMod = event.metaKey || event.ctrlKey

      if (isMod && key === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
        return
      }

      if (isMod && key === 'y') {
        event.preventDefault()
        redo()
        return
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        removeSelected()
        return
      }

      if (key === 'v') setTool('select')
      if (key === 'h') setTool('pan')
      if (key === 'r') setTool('rect')
      if (key === 'o') setTool('ellipse')
      if (key === 'l') setTool('line')
      if (key === 'a') setTool('arrow')
      if (key === 'p') setTool('draw')
      if (key === 't') setTool('text')
      if (key === '+') zoomByStep(1)
      if (key === '-') zoomByStep(-1)
    }

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') setSpacePan(false)
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [redo, removeSelected, undo, zoomByStep])

  return (
    <div className="workspace-shell">
      <Stage
        ref={(node) => {
          stageRef.current = node
        }}
        className="stage"
        width={viewport.width}
        height={viewport.height}
        draggable={activeTool === 'pan'}
        x={stagePos.x}
        y={stagePos.y}
        scaleX={stageScale}
        scaleY={stageScale}
        onDragEnd={(event) => setStagePos({ x: event.target.x(), y: event.target.y() })}
        onWheel={(event) => {
          event.evt.preventDefault()
          const pointer = stageRef.current?.getPointerPosition()
          if (!pointer) return
          const direction = event.evt.deltaY > 0 ? -1 : 1
          setZoomAroundPoint(stageScale + direction * 0.08, pointer)
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
      >
        <Layer>
          {shapes.map((shape) => {
            const isSelected = selectedId === shape.id
            const common = {
              key: shape.id,
              draggable: activeTool === 'select',
              onClick: () => setSelectedId(shape.id),
              onTap: () => setSelectedId(shape.id),
              onDragStart: () => {
                dragSnapshotRef.current = shapes
              },
              onDragEnd: (event: Konva.KonvaEventObject<DragEvent>) => {
                const nodeX = event.target.x()
                const nodeY = event.target.y()

                updateShape(shape.id, (nextShape) => {
                  if (nextShape.type === 'rect' || nextShape.type === 'ellipse' || nextShape.type === 'text') {
                    return { ...nextShape, x: nodeX + nextShape.x, y: nodeY + nextShape.y }
                  }

                  if (nextShape.type === 'line' || nextShape.type === 'arrow' || nextShape.type === 'draw') {
                    const translated = nextShape.points.map((point, index) =>
                      index % 2 === 0 ? point + nodeX : point + nodeY,
                    )
                    return { ...nextShape, points: translated }
                  }

                  return nextShape
                })

                if (dragSnapshotRef.current) {
                  pushUndoState(dragSnapshotRef.current)
                }

                dragSnapshotRef.current = null
                event.target.position({ x: 0, y: 0 })
              },
              sceneFunc: (context: any, shapeNode: any) => {
                const roughCanvas = rough.canvas(context.canvas._canvas)
                const options = {
                  stroke: shape.stroke,
                  strokeWidth: shape.strokeWidth,
                  roughness: shape.roughness,
                  fill: shape.fill === '#00000000' ? undefined : shape.fill,
                  fillStyle: 'hachure' as const,
                }

                // Apply Konva transformations
                context.save()
                
                if (shape.type === 'rect') {
                  const drawing = generator.rectangle(shape.x, shape.y, shape.width, shape.height, options)
                  roughCanvas.draw(drawing)
                } else if (shape.type === 'ellipse') {
                  const drawing = generator.ellipse(shape.x, shape.y, shape.radiusX * 2, shape.radiusY * 2, options)
                  roughCanvas.draw(drawing)
                } else if (shape.type === 'line') {
                  const drawing = generator.line(shape.points[0], shape.points[1], shape.points[2], shape.points[3], options)
                  roughCanvas.draw(drawing)
                } else if (shape.type === 'arrow') {
                  const drawing = generator.line(shape.points[0], shape.points[1], shape.points[2], shape.points[3], options)
                  roughCanvas.draw(drawing)
                  // Simple arrow head logic could be added here
                } else if (shape.type === 'draw') {
                  const pts: [number, number][] = []
                  for (let i = 0; i < shape.points.length; i += 2) {
                    pts.push([shape.points[i], shape.points[i+1]])
                  }
                  const drawing = generator.curve(pts, options)
                  roughCanvas.draw(drawing)
                }

                if (isSelected) {
                   // Draw selection bound manually since we are overriding sceneFunc
                }

                context.restore()
                context.fillStrokeShape(shapeNode)
              }
            }

            if (shape.type === 'text') {
              return (
                <Text
                  key={shape.id}
                  x={shape.x}
                  y={shape.y}
                  text={shape.text}
                  fontSize={shape.fontSize}
                  fill={shape.stroke}
                  draggable={activeTool === 'select'}
                  onClick={() => setSelectedId(shape.id)}
                />
              )
            }

            return <KonvaShape {...common} />
          })}
        </Layer>
      </Stage>

      <header className="top-bar panel">
        <div className="brand">
          <div className="brand-dot" />
          <div>
            <strong>Notes Draw</strong>
            <p>Excali-style canvas, custom build</p>
          </div>
        </div>

        <div className="actions">
          <button className="action-button" onClick={undo} title="Undo (Ctrl/Cmd + Z)">
            <Undo2 size={16} /> Undo
          </button>
          <button className="action-button" onClick={redo} title="Redo (Ctrl/Cmd + Y)">
            <Redo2 size={16} /> Redo
          </button>
          <button className="action-button" onClick={shareDrawing}>
            <Share2 size={16} />
            {shareState === 'publishing' && 'Publishing...'}
            {shareState === 'copied' && 'Link copied'}
            {shareState === 'failed' && 'Fallback copied'}
            {shareState === 'idle' && 'Share'}
          </button>
          <button className="action-button" onClick={exportPng}>
            <ImageDown size={16} /> PNG
          </button>
          <button className="action-button" onClick={exportJson}>
            <Download size={16} /> JSON
          </button>
          <label className="action-button upload">
            <Upload size={16} /> Import
            <input type="file" accept="application/json" onChange={importJson} />
          </label>
          <button className="action-button danger" onClick={clearAll}>
            <Trash2 size={16} /> Clear
          </button>
        </div>
      </header>

      <aside className="left-rail panel">
        {TOOL_DEFINITIONS.map((entry) => {
          const Icon = entry.icon
          const isActive = activeTool === entry.id

          return (
            <button
              key={entry.id}
              className={`rail-button ${isActive ? 'active' : ''}`}
              onClick={() => setTool(entry.id)}
              title={`${entry.label} (${entry.shortcut})`}
            >
              <Icon size={18} />
              <span>{entry.shortcut}</span>
            </button>
          )
        })}
      </aside>

      <aside className="right-panel panel">
        <h3>Properties</h3>
        <p>{selectedShape ? `Selected: ${selectedShape.type}` : 'No shape selected'}</p>

        <div className="control-row">
          <label>Stroke</label>
          <input
            type="color"
            value={stroke}
            onChange={(event) => {
              const next = event.target.value
              setStroke(next)
              if (selectedId) updateShape(selectedId, s => ({ ...s, stroke: next }))
            }}
          />
        </div>

        <div className="control-row">
          <label>Fill</label>
          <input
            type="color"
            value={fill === '#00000000' ? '#ffffff' : fill}
            onChange={(event) => {
              const next = event.target.value
              setFill(next)
              if (selectedId) updateShape(selectedId, s => ({ ...s, fill: next }))
            }}
          />
        </div>

        <div className="control-column">
          <label>Stroke width: {strokeWidth}px</label>
          <input
            type="range"
            min={1}
            max={12}
            value={strokeWidth}
            onChange={(event) => {
              const next = Number(event.target.value)
              setStrokeWidth(next)
              if (selectedId) updateShape(selectedId, s => ({ ...s, strokeWidth: next }))
            }}
          />
        </div>

        <div className="control-column">
          <label>Roughness: {roughness}</label>
          <input
            type="range"
            min={0}
            max={5}
            step={0.5}
            value={roughness}
            onChange={(event) => {
              const next = Number(event.target.value)
              setRoughness(next)
              if (selectedId) updateShape(selectedId, s => ({ ...s, roughness: next }))
            }}
          />
        </div>

        <div className="control-column">
          <label>Zoom: {Math.round(stageScale * 100)}%</label>
          <div className="zoom-actions">
            <button className="action-button" onClick={() => zoomByStep(-1)}>
              <ZoomOut size={15} />
            </button>
            <button className="action-button" onClick={() => zoomByStep(1)}>
              <ZoomIn size={15} />
            </button>
          </div>
        </div>

        {selectedId && (
          <button className="action-button danger full" onClick={removeSelected}>
            <Trash2 size={15} /> Delete selected
          </button>
        )}
      </aside>

      <footer className="bottom-hud panel">
        <span>Space = temporary pan</span>
        <span>V/H/R/O/L/A/P/T = quick tools</span>
        <span>{shapes.length} objects</span>
      </footer>
    </div>
  )
}
