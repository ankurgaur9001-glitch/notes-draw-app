import { useEffect, useRef, useState, useCallback } from 'react'
import { Layer, Stage, Text, Shape as KonvaShape, Transformer } from 'react-konva'
import type Konva from 'konva'
import rough from 'roughjs'
import { z } from 'zod'
import { fromError } from 'zod-validation-error'
import {
  ArrowRight,
  Circle as CircleIcon,
  Download,
  FileCode,
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
  fillStyle: 'hachure' | 'solid' | 'zigzag' | 'cross-hatch' | 'dots' | 'sunburst'
  angle: number
}

type RectShape = ShapeBase & { type: 'rect'; x: number; y: number; width: number; height: number }
type EllipseShape = ShapeBase & { type: 'ellipse'; x: number; y: number; radiusX: number; radiusY: number }
type LineShape = ShapeBase & { type: 'line' | 'arrow'; points: number[] }
type DrawShape = ShapeBase & { type: 'draw'; points: number[] }
type TextShape = ShapeBase & { type: 'text'; x: number; y: number; text: string; fontSize: number }

type Shape = RectShape | EllipseShape | LineShape | DrawShape | TextShape

const CURRENT_VERSION = 3
const LOCAL_SCENE_KEY = 'notes-draw-app.scene.v3'

const ShapeSchema = z.discriminatedUnion('type', [
  z.object({
    id: z.string(),
    type: z.literal('rect'),
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
    stroke: z.string(),
    fill: z.string(),
    strokeWidth: z.number(),
    roughness: z.number(),
    fillStyle: z.enum(['hachure', 'solid', 'zigzag', 'cross-hatch', 'dots', 'sunburst']),
    angle: z.number(),
  }),
  z.object({
    id: z.string(),
    type: z.literal('ellipse'),
    x: z.number(),
    y: z.number(),
    radiusX: z.number(),
    radiusY: z.number(),
    stroke: z.string(),
    fill: z.string(),
    strokeWidth: z.number(),
    roughness: z.number(),
    fillStyle: z.enum(['hachure', 'solid', 'zigzag', 'cross-hatch', 'dots', 'sunburst']),
    angle: z.number(),
  }),
  z.object({
    id: z.string(),
    type: z.union([z.literal('line'), z.literal('arrow')]),
    points: z.array(z.number()),
    stroke: z.string(),
    fill: z.string(),
    strokeWidth: z.number(),
    roughness: z.number(),
    fillStyle: z.enum(['hachure', 'solid', 'zigzag', 'cross-hatch', 'dots', 'sunburst']),
    angle: z.number(),
  }),
  z.object({
    id: z.string(),
    type: z.literal('draw'),
    points: z.array(z.number()),
    stroke: z.string(),
    fill: z.string(),
    strokeWidth: z.number(),
    roughness: z.number(),
    fillStyle: z.enum(['hachure', 'solid', 'zigzag', 'cross-hatch', 'dots', 'sunburst']),
    angle: z.number(),
  }),
  z.object({
    id: z.string(),
    type: z.literal('text'),
    x: z.number(),
    y: z.number(),
    text: z.string(),
    fontSize: z.number(),
    stroke: z.string(),
    fill: z.string(),
    strokeWidth: z.number(),
    roughness: z.number(),
    fillStyle: z.enum(['hachure', 'solid', 'zigzag', 'cross-hatch', 'dots', 'sunburst']),
    angle: z.number(),
  }),
])

const SceneSchema = z.object({
  version: z.number(),
  shapes: z.array(ShapeSchema),
  appState: z.object({
    stagePos: z.object({ x: z.number(), y: z.number() }).optional(),
    stageScale: z.number().optional(),
  }).optional(),
})

type Scene = z.infer<typeof SceneSchema>

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
const JSONBLOB_ENDPOINT = 'https://jsonblob.com/api/jsonBlob'

const generator = rough.generator()

const migrateScene = (data: any): Shape[] => {
  // Migration logic
  if (Array.isArray(data)) {
    // V1/V2 format: just an array of shapes
    return data as Shape[]
  }
  
  if (data && typeof data === 'object' && 'version' in data) {
    if (data.version === 3) {
      return data.shapes
    }
  }
  
  return []
}

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
  const [fillStyle, setFillStyle] = useState<Shape['fillStyle']>('hachure')
  const [shapes, setShapes] = useState<Shape[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [isDrawing, setIsDrawing] = useState(false)
  const [isSelecting, setIsSelecting] = useState(false)
  const [selectionRect, setSelectionRect] = useState<{ x: number, y: number, width: number, height: number } | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')
  const [history, setHistory] = useState<Shape[][]>([])
  const [redoStack, setRedoStack] = useState<Shape[][]>([])
  const [stageScale, setStageScale] = useState(1)
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 })
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight })
  const [shareState, setShareState] = useState<'idle' | 'publishing' | 'copied' | 'failed'>('idle')

  const stageRef = useRef<Konva.Stage | null>(null)
  const transformerRef = useRef<Konva.Transformer | null>(null)
  const draftRef = useRef<Shape | null>(null)
  const drawSnapshotRef = useRef<Shape[] | null>(null)
  const dragSnapshotRef = useRef<Shape[] | null>(null)

  const activeTool = spacePan ? 'pan' : tool

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

        let rawData: any = null

        if (blobId) {
          const response = await fetch(`${JSONBLOB_ENDPOINT}/${blobId}`)
          if (response.ok) {
            rawData = await response.json()
          }
        }

        const encoded = params.get('drawing')
        if (!rawData && encoded) {
          rawData = decodeDrawing(encoded)
        }

        if (!rawData) {
          const localScene = localStorage.getItem(LOCAL_SCENE_KEY) || localStorage.getItem('notes-draw-app.scene.v2')
          if (localScene) {
            rawData = JSON.parse(localScene)
          }
        }

        if (rawData) {
          const shapes = migrateScene(rawData)
          const validated = z.array(ShapeSchema).parse(shapes)
          setShapes(validated)
          
          if (rawData.appState) {
            if (rawData.appState.stagePos) setStagePos(rawData.appState.stagePos)
            if (rawData.appState.stageScale) setStageScale(rawData.appState.stageScale)
          }
        }
      } catch (error) {
        console.error('Failed to hydrate scene', error)
        if (error instanceof z.ZodError) {
          console.warn('Validation error:', fromError(error).toString())
        }
      }
    }

    void loadScene()
  }, [])

  useEffect(() => {
    try {
      const scene: Scene = {
        version: CURRENT_VERSION,
        shapes,
        appState: { stagePos, stageScale }
      }
      localStorage.setItem(LOCAL_SCENE_KEY, JSON.stringify(scene))
    } catch (error) {
      console.error('Autosave failed', error)
    }
  }, [shapes, stagePos, stageScale])

  useEffect(() => {
    if (transformerRef.current) {
      const stage = stageRef.current;
      if (!stage) return;
      const nodes = selectedIds.map(id => stage.findOne(`#${id}`)).filter(Boolean);
      transformerRef.current.nodes(nodes as Konva.Node[]);
      transformerRef.current.getLayer()?.batchDraw();
    }
  }, [selectedIds, shapes]);

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
      if (editingId) {
        finishEditing()
        return
      }
      const pointer = stage.getPointerPosition()
      if (!pointer) return
      const intersection = stage.getIntersection(pointer)
      
      if (!intersection) {
        setSelectedIds([])
        setIsSelecting(true)
        setSelectionRect({ x: p.x, y: p.y, width: 0, height: 0 })
      } else {
        const shapeNode = intersection.findAncestor('.konva-shape') || intersection
        const id = shapeNode.id()
        if (id) {
          setSelectedIds(prev => prev.includes(id) ? prev : [id])
        }
      }
      return
    }

    if (activeTool === 'text') {
      const id = uid()
      const newTextShape: TextShape = {
        id,
        type: 'text',
        x: p.x,
        y: p.y,
        text: '',
        fontSize: 24,
        stroke,
        fill: '#00000000',
        strokeWidth,
        roughness,
        fillStyle,
        angle: 0,
      }
      
      setShapes(prev => [...prev, newTextShape])
      setEditingId(id)
      setEditingText('')
      return
    }

    if (activeTool === 'pan') return

    drawSnapshotRef.current = shapes
    setIsDrawing(true)

    const id = uid()

    if (activeTool === 'rect') {
      draftRef.current = { id, type: 'rect', x: p.x, y: p.y, width: 1, height: 1, stroke, fill, strokeWidth, roughness, fillStyle, angle: 0 }
    }

    if (activeTool === 'ellipse') {
      draftRef.current = { id, type: 'ellipse', x: p.x, y: p.y, radiusX: 1, radiusY: 1, stroke, fill, strokeWidth, roughness, fillStyle, angle: 0 }
    }

    if (activeTool === 'line') {
      draftRef.current = { id, type: 'line', points: [p.x, p.y, p.x, p.y], stroke, fill, strokeWidth, roughness, fillStyle, angle: 0 }
    }

    if (activeTool === 'arrow') {
      draftRef.current = { id, type: 'arrow', points: [p.x, p.y, p.x, p.y], stroke, fill, strokeWidth, roughness, fillStyle, angle: 0 }
    }

    if (activeTool === 'draw') {
      draftRef.current = { id, type: 'draw', points: [p.x, p.y], stroke, fill: '#00000000', strokeWidth, roughness, fillStyle, angle: 0 }
    }

    if (draftRef.current) {
      setShapes((prev) => [...prev, draftRef.current as Shape])
    }
  }

  const handleMouseMove = () => {
    const stage = stageRef.current
    if (!stage) return
    const p = pointerToCanvas(stage)
    if (!p) return

    if (isSelecting && selectionRect) {
      setSelectionRect(prev => prev ? ({ ...prev, width: p.x - prev.x, height: p.y - prev.y }) : null)
      return
    }

    if (!isDrawing || !draftRef.current) return

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
    if (isSelecting && selectionRect) {
      const x1 = Math.min(selectionRect.x, selectionRect.x + selectionRect.width)
      const x2 = Math.max(selectionRect.x, selectionRect.x + selectionRect.width)
      const y1 = Math.min(selectionRect.y, selectionRect.y + selectionRect.height)
      const y2 = Math.max(selectionRect.y, selectionRect.y + selectionRect.height)

      const boxSelected = shapes.filter(s => {
        if (s.type === 'rect' || s.type === 'text') {
          return s.x >= x1 && s.x <= x2 && s.y >= y1 && s.y <= y2
        }
        if (s.type === 'ellipse') {
          return s.x >= x1 && s.x <= x2 && s.y >= y1 && s.y <= y2
        }
        if (s.type === 'line' || s.type === 'arrow' || s.type === 'draw') {
          return s.points.some((p, i) => i % 2 === 0 ? (p >= x1 && p <= x2) : (p >= y1 && p <= y2))
        }
        return false
      }).map(s => s.id)

      setSelectedIds(boxSelected)
      setIsSelecting(false)
      setSelectionRect(null)
      return
    }

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

  const undo = useCallback(() => {
    if (!history.length) return

    const previousScene = history[history.length - 1]
    setRedoStack((prev) => [shapes, ...prev].slice(0, SNAPSHOT_LIMIT))
    setHistory((prev) => prev.slice(0, -1))
    setShapes(previousScene)
    setSelectedIds([])
  }, [history, shapes])

  const redo = useCallback(() => {
    if (!redoStack.length) return

    const nextScene = redoStack[0]
    setHistory((prev) => [...prev.slice(-SNAPSHOT_LIMIT + 1), shapes])
    setRedoStack((prev) => prev.slice(1))
    setShapes(nextScene)
    setSelectedIds([])
  }, [redoStack, shapes])

  const removeSelected = useCallback(() => {
    if (selectedIds.length === 0) return
    commitScene(shapes.filter((shape) => !selectedIds.includes(shape.id)))
    setSelectedIds([])
  }, [selectedIds, shapes])

  const finishEditing = useCallback(() => {
    if (!editingId) return
    const shape = shapes.find(s => s.id === editingId) as TextShape | undefined
    if (shape && editingText.trim() === '') {
      setShapes(prev => prev.filter(s => s.id !== editingId))
    } else {
      setShapes(prev => prev.map(s => s.id === editingId ? { ...s, text: editingText } : s))
      pushUndoState(shapes.filter(s => s.id !== editingId))
    }
    setEditingId(null)
    setEditingText('')
  }, [editingId, editingText, shapes])

  const exportJson = () => {
    const scene: Scene = {
      version: CURRENT_VERSION,
      shapes,
      appState: { stagePos, stageScale }
    }
    const blob = new Blob([JSON.stringify(scene, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `drawing-${Date.now()}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const importJson = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      const content = await file.text()
      const rawData = JSON.parse(content)
      const shapes = migrateScene(rawData)
      const validated = z.array(ShapeSchema).parse(shapes)
      
      commitScene(validated)
      if (rawData.appState) {
        if (rawData.appState.stagePos) setStagePos(rawData.appState.stagePos)
        if (rawData.appState.stageScale) setStageScale(rawData.appState.stageScale)
      }
      setSelectedIds([])
    } catch (error) {
      console.error('Failed to import JSON', error)
      let msg = 'Invalid JSON file'
      if (error instanceof z.ZodError) {
        msg = fromError(error).toString()
      }
      alert(msg)
    } finally {
      event.target.value = ''
    }
  }

  const exportPng = () => {
    const dataUrl = stageRef.current?.toDataURL({ pixelRatio: 2 })
    if (!dataUrl) return

    const anchor = document.createElement('a')
    anchor.href = dataUrl
    anchor.download = `drawing-${Date.now()}.png`
    anchor.click()
  }

  const exportSvg = () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    const roughSvg = rough.svg(svg)
    
    // Find bounds
    if (shapes.length === 0) return
    
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    
    shapes.forEach(s => {
      if (s.type === 'rect' || s.type === 'text') {
        minX = Math.min(minX, s.x); minY = Math.min(minY, s.y)
        maxX = Math.max(maxX, s.x + (s.type === 'rect' ? s.width : 100))
        maxY = Math.max(maxY, s.y + (s.type === 'rect' ? s.height : 24))
      } else if (s.type === 'ellipse') {
        minX = Math.min(minX, s.x - s.radiusX); minY = Math.min(minY, s.y - s.radiusY)
        maxX = Math.max(maxX, s.x + s.radiusX); maxY = Math.max(maxY, s.y + s.radiusY)
      } else {
        for (let i = 0; i < s.points.length; i += 2) {
          minX = Math.min(minX, s.points[i]); minY = Math.min(minY, s.points[i+1])
          maxX = Math.max(maxX, s.points[i]); maxY = Math.max(maxY, s.points[i+1])
        }
      }
    })
    
    const padding = 20
    minX -= padding; minY -= padding; maxX += padding; maxY += padding
    const width = maxX - minX
    const height = maxY - minY
    
    svg.setAttribute('width', width.toString())
    svg.setAttribute('height', height.toString())
    svg.setAttribute('viewBox', `${minX} ${minY} ${width} ${height}`)
    svg.setAttribute('style', 'background-color: transparent;')

    shapes.forEach(shape => {
      const options = {
        stroke: shape.stroke,
        strokeWidth: shape.strokeWidth,
        roughness: shape.roughness,
        fill: shape.fill === '#00000000' ? undefined : shape.fill,
        fillStyle: shape.fillStyle,
      }

      let node: SVGElement | null = null
      
      if (shape.type === 'rect') {
        node = roughSvg.rectangle(shape.x, shape.y, shape.width, shape.height, options)
      } else if (shape.type === 'ellipse') {
        node = roughSvg.ellipse(shape.x, shape.y, shape.radiusX * 2, shape.radiusY * 2, options)
      } else if (shape.type === 'line' || shape.type === 'arrow') {
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g')
        group.appendChild(roughSvg.line(shape.points[0], shape.points[1], shape.points[2], shape.points[3], options))
        if (shape.type === 'arrow') {
           const x1 = shape.points[0], y1 = shape.points[1], x2 = shape.points[2], y2 = shape.points[3]
           const angle = Math.atan2(y2 - y1, x2 - x1)
           const headLength = 15
           group.appendChild(roughSvg.line(x2, y2, x2 - headLength * Math.cos(angle - Math.PI / 6), y2 - headLength * Math.sin(angle - Math.PI / 6), options))
           group.appendChild(roughSvg.line(x2, y2, x2 - headLength * Math.cos(angle + Math.PI / 6), y2 - headLength * Math.sin(angle + Math.PI / 6), options))
        }
        node = group
      } else if (shape.type === 'draw') {
        const pts: [number, number][] = []
        for (let i = 0; i < shape.points.length; i += 2) pts.push([shape.points[i], shape.points[i+1]])
        node = roughSvg.curve(pts, options)
      } else if (shape.type === 'text') {
        const textNode = document.createElementNS('http://www.w3.org/2000/svg', 'text')
        textNode.setAttribute('x', shape.x.toString())
        textNode.setAttribute('y', (shape.y + shape.fontSize).toString())
        textNode.setAttribute('font-family', 'sans-serif')
        textNode.setAttribute('font-size', shape.fontSize.toString())
        textNode.setAttribute('fill', shape.stroke)
        if (shape.angle) textNode.setAttribute('transform', `rotate(${shape.angle}, ${shape.x}, ${shape.y})`)
        textNode.textContent = shape.text
        node = textNode
      }

      if (node) {
        if (shape.angle && shape.type !== 'text') {
          let cx = 0, cy = 0
          if (shape.type === 'rect' || shape.type === 'ellipse') {
            cx = shape.x; cy = shape.y
          } else {
            cx = shape.points[0]; cy = shape.points[1]
          }
          node.setAttribute('transform', `rotate(${shape.angle}, ${cx}, ${cy})`)
        }
        svg.appendChild(node)
      }
    })

    const svgData = new XMLSerializer().serializeToString(svg)
    const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `drawing-${Date.now()}.svg`
    anchor.click()
    URL.revokeObjectURL(url)
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
    setSelectedIds([])
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (editingId) {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault()
          finishEditing()
        }
        if (event.key === 'Escape') {
          finishEditing()
        }
        return
      }

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
          {editingId && (
            <textarea
              autoFocus
              className="inline-text-editor"
              style={{
                position: 'absolute',
                top: ((shapes.find(s => s.id === editingId) as TextShape)?.y || 0) * stageScale + stagePos.y,
                left: ((shapes.find(s => s.id === editingId) as TextShape)?.x || 0) * stageScale + stagePos.x,
                fontSize: ((shapes.find(s => s.id === editingId) as TextShape)?.fontSize || 24) * stageScale,
                color: ((shapes.find(s => s.id === editingId) as TextShape)?.stroke || '#000'),
                transform: `rotate(${(shapes.find(s => s.id === editingId) as TextShape)?.angle || 0}deg)`,
                transformOrigin: 'top left'
              }}
              value={editingText}
              onChange={(e) => setEditingText(e.target.value)}
              onBlur={finishEditing}
            />
          )}
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
            const isSelected = selectedIds.includes(shape.id)
            const isText = shape.type === 'text'
            
            if (isText) {
              return (
                <Text
                  key={shape.id}
                  id={shape.id}
                  x={shape.x}
                  y={shape.y}
                  rotation={shape.angle}
                  text={shape.text}
                  fontSize={shape.fontSize}
                  fill={shape.stroke}
                  draggable={activeTool === 'select' && isSelected}
                  onDragEnd={(event: Konva.KonvaEventObject<DragEvent>) => {
                    if (event.target !== event.currentTarget) return;
                    setShapes(prev => prev.map(s => {
                      if (s.id === shape.id && s.type === 'text') {
                        return { ...s, x: event.target.x(), y: event.target.y() }
                      }
                      return s
                    }))
                  }}
                  onTransformEnd={(event: any) => {
                    const node = event.target;
                    setShapes(prev => prev.map(s => {
                      if (s.id === shape.id && s.type === 'text') {
                        return {
                          ...s,
                          x: node.x(),
                          y: node.y(),
                          fontSize: s.fontSize * node.scaleX(),
                          angle: node.rotation()
                        }
                      }
                      return s
                    }));
                    node.scaleX(1);
                    node.scaleY(1);
                  }}
                  onDblClick={() => {
                    setEditingId(shape.id)
                    setEditingText(shape.text)
                  }}
                  onClick={(e: any) => {
                    if (activeTool !== 'select') return;
                    e.cancelBubble = true;
                    if (e.evt.shiftKey) {
                      setSelectedIds(prev => prev.includes(shape.id) ? prev.filter(id => id !== shape.id) : [...prev, shape.id])
                    } else {
                      setSelectedIds([shape.id])
                    }
                  }}
                />
              )
            }

            const common = {
              key: shape.id,
              id: shape.id,
              draggable: activeTool === 'select' && isSelected,
              onClick: (e: any) => {
                if (activeTool !== 'select') return;
                e.cancelBubble = true;
                if (e.evt.shiftKey) {
                  setSelectedIds(prev => prev.includes(shape.id) ? prev.filter(id => id !== shape.id) : [...prev, shape.id])
                } else {
                  setSelectedIds([shape.id])
                }
              },
              onDragStart: () => {
                dragSnapshotRef.current = shapes
              },
              onDragEnd: (event: Konva.KonvaEventObject<DragEvent>) => {
                if (event.target !== event.currentTarget) return;
                const nodeX = event.target.x()
                const nodeY = event.target.y()

                setShapes(prev => prev.map(s => {
                  if (!selectedIds.includes(s.id)) return s;
                  
                  if (s.type === 'rect' || s.type === 'ellipse' || s.type === 'text') {
                    return { ...s, x: s.x + nodeX, y: s.y + nodeY }
                  }
                  if (s.type === 'line' || s.type === 'arrow' || s.type === 'draw') {
                    const translated = s.points.map((p, i) => i % 2 === 0 ? p + nodeX : p + nodeY)
                    return { ...s, points: translated }
                  }
                  return s
                }))

                if (dragSnapshotRef.current) {
                  pushUndoState(dragSnapshotRef.current)
                }

                dragSnapshotRef.current = null
                event.target.position({ x: 0, y: 0 })
              },
              onTransformEnd: (event: any) => {
                const node = event.target;
                setShapes(prev => prev.map(s => {
                  if (s.id !== shape.id) return s;
                  
                  if (s.type === 'rect') {
                    return { 
                      ...s, 
                      x: node.x(), 
                      y: node.y(), 
                      width: s.width * node.scaleX(), 
                      height: s.height * node.scaleY(),
                      angle: node.rotation()
                    };
                  }
                  if (s.type === 'ellipse') {
                    return { 
                      ...s, 
                      x: node.x(), 
                      y: node.y(), 
                      radiusX: s.radiusX * node.scaleX(), 
                      radiusY: s.radiusY * node.scaleY(),
                      angle: node.rotation()
                    };
                  }
                  return s;
                }));
                node.scaleX(1);
                node.scaleY(1);
              },
              sceneFunc: (context: any, shapeNode: any) => {
                shapeNode.name('konva-shape');
                const roughCanvas = rough.canvas(context.canvas._canvas)
                const options = {
                  stroke: shape.stroke,
                  strokeWidth: shape.strokeWidth,
                  roughness: shape.roughness,
                  fill: shape.fill === '#00000000' ? undefined : shape.fill,
                  fillStyle: shape.fillStyle,
                }

                context.save()
                
                if (shape.angle) {
                   const cx = (shape as any).x || 0
                   const cy = (shape as any).y || 0
                   context.translate(cx, cy);
                   context.rotate(shape.angle * Math.PI / 180);
                   context.translate(-cx, -cy);
                }

                if (shape.type === 'rect') {
                  const drawing = generator.rectangle(shape.x, shape.y, shape.width, shape.height, options)
                  roughCanvas.draw(drawing)
                } else if (shape.type === 'ellipse') {
                  const drawing = generator.ellipse(shape.x, shape.y, shape.radiusX * 2, shape.radiusY * 2, options)
                  roughCanvas.draw(drawing)
                } else if (shape.type === 'line' || shape.type === 'arrow') {
                  const drawing = generator.line(shape.points[0], shape.points[1], shape.points[2], shape.points[3], options)
                  roughCanvas.draw(drawing)
                  
                  if (shape.type === 'arrow') {
                    const x1 = shape.points[0]
                    const y1 = shape.points[1]
                    const x2 = shape.points[2]
                    const y2 = shape.points[3]
                    const dx = x2 - x1
                    const dy = y2 - y1
                    const angle = Math.atan2(dy, dx)
                    const headLength = 15
                    
                    const head1X = x2 - headLength * Math.cos(angle - Math.PI / 6)
                    const head1Y = y2 - headLength * Math.sin(angle - Math.PI / 6)
                    const head2X = x2 - headLength * Math.cos(angle + Math.PI / 6)
                    const head2Y = y2 - headLength * Math.sin(angle + Math.PI / 6)
                    
                    roughCanvas.draw(generator.line(x2, y2, head1X, head1Y, options))
                    roughCanvas.draw(generator.line(x2, y2, head2X, head2Y, options))
                  }
                } else if (shape.type === 'draw') {
                  const pts: [number, number][] = []
                  for (let i = 0; i < shape.points.length; i += 2) {
                    pts.push([shape.points[i], shape.points[i+1]])
                  }
                  const drawing = generator.curve(pts, options)
                  roughCanvas.draw(drawing)
                }

                context.restore()
                context.fillStrokeShape(shapeNode)
              }
            }

            return <KonvaShape {...common} />
          })}
          {selectedIds.length > 0 && activeTool === 'select' && (
            <Transformer
              ref={transformerRef}
              boundBoxFunc={(oldBox, newBox) => {
                if (Math.abs(newBox.width) < 5 || Math.abs(newBox.height) < 5) {
                  return oldBox;
                }
                return newBox;
              }}
            />
          )}
          {selectionRect && (
            <KonvaShape
              sceneFunc={(context) => {
                const roughCanvas = rough.canvas(context.canvas._canvas)
                roughCanvas.draw(generator.rectangle(selectionRect.x, selectionRect.y, selectionRect.width, selectionRect.height, {
                  stroke: '#4f46e5',
                  strokeWidth: 1,
                  fill: 'rgba(79, 70, 229, 0.1)',
                  fillStyle: 'solid',
                  roughness: 0,
                }))
              }}
            />
          )}
        </Layer>
      </Stage>

      <header className="top-bar panel">
        <div className="brand">
          <div className="brand-dot" />
          <div>
            <strong>ClawCanvas</strong>
            <p>Agentic sketchpad powered by OpenClaw</p>
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
          <button className="action-button" onClick={exportSvg}>
            <FileCode size={16} /> SVG
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
        <p>{selectedIds.length > 0 ? `Selected: ${selectedIds.length} objects` : 'No shape selected'}</p>

        <div className="control-row">
          <label>Stroke</label>
          <input
            type="color"
            value={stroke}
            onChange={(event) => {
              const next = event.target.value
              setStroke(next)
              if (selectedIds.length > 0) {
                setShapes(prev => prev.map(s => selectedIds.includes(s.id) ? { ...s, stroke: next } : s))
              }
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
              if (selectedIds.length > 0) {
                setShapes(prev => prev.map(s => selectedIds.includes(s.id) ? { ...s, fill: next } : s))
              }
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
              if (selectedIds.length > 0) {
                setShapes(prev => prev.map(s => selectedIds.includes(s.id) ? { ...s, strokeWidth: next } : s))
              }
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
              if (selectedIds.length > 0) {
                setShapes(prev => prev.map(s => selectedIds.includes(s.id) ? { ...s, roughness: next } : s))
              }
            }}
          />
        </div>

        <div className="control-column">
          <label>Fill Style</label>
          <select 
            value={fillStyle} 
            onChange={(e) => {
              const next = e.target.value as Shape['fillStyle']
              setFillStyle(next)
              if (selectedIds.length > 0) {
                setShapes(prev => prev.map(s => selectedIds.includes(s.id) ? { ...s, fillStyle: next } : s))
              }
            }}
            className="action-button full"
          >
            <option value="hachure">Hachure</option>
            <option value="solid">Solid</option>
            <option value="zigzag">Zigzag</option>
            <option value="cross-hatch">Cross-hatch</option>
            <option value="dots">Dots</option>
            <option value="sunburst">Sunburst</option>
          </select>
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

        {selectedIds.length > 0 && (
          <button className="action-button danger full" onClick={removeSelected}>
            <Trash2 size={15} /> Delete selected
          </button>
        )}
      </aside>

      <footer className="bottom-hud panel">
        <div className="hud-hints">
          <span>Space = temporary pan</span>
          <span>V/H/R/O/L/A/P/T = quick tools</span>
          <span>{shapes.length} objects</span>
        </div>
        <div className="credits">
          made with <strong>OpenClaw</strong> &lt;3 <strong>RJ</strong>
        </div>
      </footer>
    </div>
  )
}
