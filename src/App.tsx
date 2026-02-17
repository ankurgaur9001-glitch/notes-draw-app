import { useEffect, useMemo, useRef, useState } from 'react'
import { Arrow, Ellipse, Layer, Line, Rect, Stage, Text } from 'react-konva'
import type Konva from 'konva'
import './index.css'

type Tool = 'select' | 'rect' | 'ellipse' | 'line' | 'arrow' | 'draw' | 'text' | 'pan'

type ShapeBase = {
  id: string
  stroke: string
  fill: string
  strokeWidth: number
}

type RectShape = ShapeBase & { type: 'rect'; x: number; y: number; width: number; height: number }
type EllipseShape = ShapeBase & { type: 'ellipse'; x: number; y: number; radiusX: number; radiusY: number }
type LineShape = ShapeBase & { type: 'line' | 'arrow'; points: number[] }
type DrawShape = ShapeBase & { type: 'draw'; points: number[] }
type TextShape = ShapeBase & { type: 'text'; x: number; y: number; text: string; fontSize: number }

type Shape = RectShape | EllipseShape | LineShape | DrawShape | TextShape

const uid = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`

const SNAPSHOT_LIMIT = 100

const encodeDrawing = (input: Shape[]) => btoa(unescape(encodeURIComponent(JSON.stringify(input))))
const decodeDrawing = (input: string) => JSON.parse(decodeURIComponent(escape(atob(input)))) as Shape[]

export default function App() {
  const [tool, setTool] = useState<Tool>('select')
  const [stroke, setStroke] = useState('#111827')
  const [fill, setFill] = useState('#00000000')
  const [strokeWidth, setStrokeWidth] = useState(2)
  const [shapes, setShapes] = useState<Shape[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [history, setHistory] = useState<Shape[][]>([])
  const [redoStack, setRedoStack] = useState<Shape[][]>([])
  const [stageScale, setStageScale] = useState(1)
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 })

  const containerRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<Konva.Stage | null>(null)
  const draftRef = useRef<Shape | null>(null)

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search)
      const encoded = params.get('drawing')
      if (!encoded) return
      const parsed = decodeDrawing(encoded)
      if (Array.isArray(parsed)) setShapes(parsed)
    } catch (error) {
      console.error('Invalid share link payload', error)
    }
  }, [])

  const viewport = useMemo(() => {
    const w = containerRef.current?.clientWidth ?? window.innerWidth
    const h = containerRef.current?.clientHeight ?? window.innerHeight
    return { width: w, height: h }
  }, [containerRef.current?.clientWidth, containerRef.current?.clientHeight])

  const pushHistory = (nextShapes: Shape[]) => {
    setHistory((prev) => [...prev.slice(-SNAPSHOT_LIMIT + 1), shapes])
    setRedoStack([])
    setShapes(nextShapes)
  }

  const pointerToCanvas = (stage: Konva.Stage) => {
    const pointer = stage.getPointerPosition()
    if (!pointer) return null
    return {
      x: (pointer.x - stagePos.x) / stageScale,
      y: (pointer.y - stagePos.y) / stageScale,
    }
  }

  const handleMouseDown = () => {
    const stage = stageRef.current
    if (!stage) return
    const p = pointerToCanvas(stage)
    if (!p) return

    if (tool === 'select') {
      const pointer = stage.getPointerPosition()
      const clickedOnEmpty = !pointer || stage.getIntersection(pointer) == null
      if (clickedOnEmpty) setSelectedId(null)
      return
    }

    if (tool === 'text') {
      const text = prompt('Enter text')
      if (!text) return
      pushHistory([
        ...shapes,
        { id: uid(), type: 'text', x: p.x, y: p.y, text, fontSize: 24, stroke, fill: '#00000000', strokeWidth },
      ])
      return
    }

    setIsDrawing(true)
    const id = uid()
    if (tool === 'rect') draftRef.current = { id, type: 'rect', x: p.x, y: p.y, width: 1, height: 1, stroke, fill, strokeWidth }
    if (tool === 'ellipse') draftRef.current = { id, type: 'ellipse', x: p.x, y: p.y, radiusX: 1, radiusY: 1, stroke, fill, strokeWidth }
    if (tool === 'line') draftRef.current = { id, type: 'line', points: [p.x, p.y, p.x, p.y], stroke, fill, strokeWidth }
    if (tool === 'arrow') draftRef.current = { id, type: 'arrow', points: [p.x, p.y, p.x, p.y], stroke, fill, strokeWidth }
    if (tool === 'draw') draftRef.current = { id, type: 'draw', points: [p.x, p.y], stroke, fill: '#00000000', strokeWidth }

    if (draftRef.current) setShapes((prev) => [...prev, draftRef.current as Shape])
  }

  const handleMouseMove = () => {
    if (!isDrawing || !draftRef.current) return
    const stage = stageRef.current
    if (!stage) return
    const p = pointerToCanvas(stage)
    if (!p) return

    setShapes((prev) => {
      const next = [...prev]
      const idx = next.findIndex((s) => s.id === draftRef.current?.id)
      if (idx < 0) return prev
      const shape = next[idx]
      if (shape.type === 'rect') {
        next[idx] = { ...shape, width: p.x - shape.x, height: p.y - shape.y }
      } else if (shape.type === 'ellipse') {
        next[idx] = { ...shape, radiusX: Math.abs(p.x - shape.x), radiusY: Math.abs(p.y - shape.y) }
      } else if (shape.type === 'line' || shape.type === 'arrow') {
        next[idx] = { ...shape, points: [shape.points[0], shape.points[1], p.x, p.y] }
      } else if (shape.type === 'draw') {
        next[idx] = { ...shape, points: [...shape.points, p.x, p.y] }
      }
      draftRef.current = next[idx]
      return next
    })
  }

  const handleMouseUp = () => {
    if (!isDrawing) return
    setIsDrawing(false)
    draftRef.current = null
    setHistory((prev) => [...prev.slice(-SNAPSHOT_LIMIT + 1), shapes])
    setRedoStack([])
  }

  const updateShape = (id: string, updater: (s: Shape) => Shape) => {
    setShapes((prev) => prev.map((s) => (s.id === id ? updater(s) : s)))
  }

  const undo = () => {
    if (!history.length) return
    const prev = history[history.length - 1]
    setRedoStack((r) => [shapes, ...r].slice(0, SNAPSHOT_LIMIT))
    setHistory((h) => h.slice(0, -1))
    setShapes(prev)
  }

  const redo = () => {
    if (!redoStack.length) return
    const next = redoStack[0]
    setHistory((h) => [...h.slice(-SNAPSHOT_LIMIT + 1), shapes])
    setRedoStack((r) => r.slice(1))
    setShapes(next)
  }

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(shapes, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'drawing.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  const importJson: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    const parsed = JSON.parse(text) as Shape[]
    pushHistory(parsed)
  }

  const exportPng = () => {
    const url = stageRef.current?.toDataURL({ pixelRatio: 2 })
    if (!url) return
    const a = document.createElement('a')
    a.href = url
    a.download = 'drawing.png'
    a.click()
  }

  const shareDrawing = async () => {
    try {
      const encoded = encodeDrawing(shapes)
      const shareUrl = `${window.location.origin}${window.location.pathname}?drawing=${encodeURIComponent(encoded)}`
      await navigator.clipboard.writeText(shareUrl)
      alert('Share link copied to clipboard')
    } catch {
      alert('Unable to create share link for this browser/session')
    }
  }

  const clearAll = () => pushHistory([])

  return (
    <div className="app" ref={containerRef}>
      <header className="toolbar">
        <div className="tool-group">
          {(['select', 'pan', 'rect', 'ellipse', 'line', 'arrow', 'draw', 'text'] as Tool[]).map((t) => (
            <button key={t} className={tool === t ? 'active' : ''} onClick={() => setTool(t)}>
              {t}
            </button>
          ))}
        </div>
        <div className="tool-group">
          <label>Stroke <input type="color" value={stroke} onChange={(e) => setStroke(e.target.value)} /></label>
          <label>Fill <input type="color" value={fill === '#00000000' ? '#ffffff' : fill} onChange={(e) => setFill(e.target.value)} /></label>
          <label>Width <input type="range" min={1} max={12} value={strokeWidth} onChange={(e) => setStrokeWidth(Number(e.target.value))} /></label>
          <button onClick={undo}>Undo</button>
          <button onClick={redo}>Redo</button>
          <button onClick={clearAll}>Clear</button>
          <button onClick={exportJson}>Save JSON</button>
          <label className="file-input">Load JSON<input type="file" accept="application/json" onChange={importJson} /></label>
          <button onClick={exportPng}>Export PNG</button>
          <button onClick={shareDrawing}>Share Link</button>
        </div>
      </header>

      <Stage
        ref={(node) => {
          stageRef.current = node
        }}
        width={viewport.width}
        height={viewport.height - 62}
        draggable={tool === 'pan'}
        x={stagePos.x}
        y={stagePos.y}
        scaleX={stageScale}
        scaleY={stageScale}
        onDragEnd={(e) => setStagePos({ x: e.target.x(), y: e.target.y() })}
        onWheel={(e) => {
          e.evt.preventDefault()
          const oldScale = stageScale
          const pointer = stageRef.current?.getPointerPosition()
          if (!pointer) return
          const direction = e.evt.deltaY > 0 ? -1 : 1
          const newScale = Math.max(0.2, Math.min(4, oldScale + direction * 0.1))
          const mousePointTo = {
            x: (pointer.x - stagePos.x) / oldScale,
            y: (pointer.y - stagePos.y) / oldScale,
          }
          const newPos = {
            x: pointer.x - mousePointTo.x * newScale,
            y: pointer.y - mousePointTo.y * newScale,
          }
          setStageScale(newScale)
          setStagePos(newPos)
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
      >
        <Layer>
          {shapes.map((s) => {
            const common = {
              key: s.id,
              stroke: s.stroke,
              strokeWidth: s.strokeWidth,
              draggable: tool === 'select',
              onClick: () => setSelectedId(s.id),
              onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => {
                const nx = e.target.x()
                const ny = e.target.y()
                updateShape(s.id, (shape) => {
                  if (shape.type === 'rect' || shape.type === 'ellipse' || shape.type === 'text') {
                    return { ...shape, x: nx, y: ny }
                  }
                  if (shape.type === 'line' || shape.type === 'arrow' || shape.type === 'draw') {
                    const [sx, sy] = [shape.points[0], shape.points[1]]
                    const dx = nx - sx
                    const dy = ny - sy
                    const moved = shape.points.map((p, i) => (i % 2 === 0 ? p + dx : p + dy))
                    return { ...shape, points: moved }
                  }
                  return shape
                })
                e.target.position({ x: 0, y: 0 })
              },
            }

            if (s.type === 'rect') {
              return <Rect {...common} x={s.x} y={s.y} width={s.width} height={s.height} fill={s.fill} dash={selectedId === s.id ? [6, 4] : []} />
            }
            if (s.type === 'ellipse') {
              return <Ellipse {...common} x={s.x} y={s.y} radiusX={s.radiusX} radiusY={s.radiusY} fill={s.fill} dash={selectedId === s.id ? [6, 4] : []} />
            }
            if (s.type === 'line') {
              return <Line {...common} points={s.points} lineCap="round" lineJoin="round" dash={selectedId === s.id ? [6, 4] : []} />
            }
            if (s.type === 'arrow') {
              return <Arrow {...common} points={s.points} pointerLength={12} pointerWidth={12} fill={s.stroke} dash={selectedId === s.id ? [6, 4] : []} />
            }
            if (s.type === 'draw') {
              return <Line {...common} points={s.points} lineCap="round" lineJoin="round" tension={0.2} />
            }
            if (s.type === 'text') {
              return <Text {...common} x={s.x} y={s.y} text={s.text} fontSize={s.fontSize} fill={s.stroke} />
            }
            return null
          })}
        </Layer>
      </Stage>
    </div>
  )
}
