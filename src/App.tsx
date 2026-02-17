import { useEffect, useRef, useState, useCallback } from 'react'
import { Layer, Stage, Text, Shape as KonvaShape, Transformer } from 'react-konva'
import type Konva from 'konva'
import rough from 'roughjs'
import { z } from 'zod'
import * as Y from 'yjs'
import { WebrtcProvider } from 'y-webrtc'
import { IndexeddbPersistence } from 'y-indexeddb'
import {
  ArrowRight,
  Circle as CircleIcon,
  Command,
  Download,
  FileCode,
  Grid3X3,
  Hand,
  ImageDown,
  Layout,
  Minus,
  Moon,
  MousePointer2,
  Pencil,
  Redo2,
  Share2,
  Square,
  Sun,
  Trash2,
  Type,
  Undo2,
  Upload,
  Users,
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

const DEFAULT_ASSETS = [
  { id: 'btn', type: 'rect', width: 100, height: 40, stroke: '#4f46e5', fill: '#4f46e5', strokeWidth: 2, roughness: 1, fillStyle: 'solid', angle: 0, label: 'Button' },
  { id: 'inp', type: 'rect', width: 180, height: 40, stroke: '#d1d5db', fill: '#ffffff', strokeWidth: 2, roughness: 0.5, fillStyle: 'solid', angle: 0, label: 'Input' },
  { id: 'card', type: 'rect', width: 200, height: 120, stroke: '#e5e7eb', fill: '#ffffff', strokeWidth: 1, roughness: 0, fillStyle: 'solid', angle: 0, label: 'Card' },
]

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

const SNAPSHOT_LIMIT = 50
const JSONBLOB_ENDPOINT = 'https://jsonblob.com/api/jsonBlob'

const generator = rough.generator()

const migrateScene = (data: any): Shape[] => {
  if (Array.isArray(data)) return data as Shape[]
  if (data && typeof data === 'object' && 'version' in data) {
    if (data.version === 3) return data.shapes
  }
  return []
}

const uid = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`
const encodeDrawing = (input: Shape[]) => btoa(unescape(encodeURIComponent(JSON.stringify(input))))
const decodeDrawing = (input: string) => JSON.parse(decodeURIComponent(escape(atob(input)))) as Shape[]
const clampScale = (value: number) => Math.max(0.1, Math.min(10, value))

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
  const [roomId, setRoomId] = useState<string | null>(null)
  const [peers, setPeers] = useState<Map<number, { x: number, y: number, name: string }>>(new Map())
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false)
  const [commandSearch, setCommandSearch] = useState('')
  const [showGrid, setShowGrid] = useState(false)
  const [isDarkMode, setIsDarkMode] = useState(false)
  const [showAssets, setShowAssets] = useState(false)
  const [touchStatus, setTouchStatus] = useState<string | null>(null)

  const stageRef = useRef<Konva.Stage | null>(null)
  const transformerRef = useRef<Konva.Transformer | null>(null)
  const draftRef = useRef<Shape | null>(null)
  const drawSnapshotRef = useRef<Shape[] | null>(null)
  const dragSnapshotRef = useRef<Shape[] | null>(null)

  const ydocRef = useRef<Y.Doc>(new Y.Doc())
  const yshapesRef = useRef<Y.Map<Shape>>(ydocRef.current.getMap('shapes'))
  const providerRef = useRef<WebrtcProvider | null>(null)

  const activeTool = spacePan ? 'pan' : tool

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const room = params.get('room')
    if (room) {
      setRoomId(room)
      const provider = new WebrtcProvider(`clawcanvas-room-${room}`, ydocRef.current, {
        signaling: [
          'wss://y-webrtc-signaling-eu.herokuapp.com',
          'wss://y-webrtc-signaling-us.herokuapp.com',
          'wss://signaling.yjs.dev'
        ]
      })
      providerRef.current = provider
      new IndexeddbPersistence(`clawcanvas-room-${room}`, ydocRef.current)
      
      const syncShapes = () => {
        const remoteShapes = Array.from(yshapesRef.current.values())
        setShapes(remoteShapes)
      }
      
      yshapesRef.current.observe(() => syncShapes())
      syncShapes()

      provider.awareness.on('change', () => {
        const states = provider.awareness.getStates()
        const newPeers = new Map()
        states.forEach((state: any, clientID: number) => {
          if (clientID !== ydocRef.current.clientID && state.user) {
            newPeers.set(clientID, state.user)
          }
        })
        setPeers(newPeers)
      })
      return () => provider.destroy()
    }
  }, [])

  const updateAwareness = (x: number, y: number) => {
    if (providerRef.current) {
      providerRef.current.awareness.setLocalStateField('user', {
        x, y, name: `User ${ydocRef.current.clientID % 100}`
      })
    }
  }

  const joinOrCreateRoom = () => {
    const id = uid().slice(0, 8)
    window.location.href = `${window.location.origin}${window.location.pathname}?room=${id}`
  }

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
          if (response.ok) rawData = await response.json()
        }
        const encoded = params.get('drawing')
        if (!rawData && encoded) rawData = decodeDrawing(encoded)
        if (!rawData) {
          const localScene = localStorage.getItem(LOCAL_SCENE_KEY) || localStorage.getItem('notes-draw-app.scene.v2')
          if (localScene) rawData = JSON.parse(localScene)
        }
        if (rawData) {
          const shapesData = migrateScene(rawData)
          const validated = z.array(ShapeSchema).parse(shapesData)
          setShapes(validated)
          if (rawData.appState) {
            if (rawData.appState.stagePos) setStagePos(rawData.appState.stagePos)
            if (rawData.appState.stageScale) setStageScale(rawData.appState.stageScale)
          }
        }
      } catch (error) {
        console.error('Failed to hydrate scene', error)
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
      const stage = stageRef.current
      if (!stage) return
      const nodes = selectedIds.map(id => stage.findOne(`#${id}`)).filter(Boolean)
      transformerRef.current.nodes(nodes as Konva.Node[])
      transformerRef.current.getLayer()?.batchDraw()
    }
  }, [selectedIds, shapes])

  const pushUndoState = (previousScene: Shape[]) => {
    setHistory((prev) => [...prev.slice(-SNAPSHOT_LIMIT + 1), previousScene])
    setRedoStack([])
  }

  const commitScene = (nextScene: Shape[], previousScene: Shape[] = shapes) => {
    pushUndoState(previousScene)
    setShapes(nextScene)
    if (roomId) {
      ydocRef.current.transact(() => {
        const nextIds = new Set(nextScene.map(s => s.id))
        const currentInY = new Set(yshapesRef.current.keys())
        currentInY.forEach(id => { if (!nextIds.has(id)) yshapesRef.current.delete(id) })
        nextScene.forEach(shape => {
          const existing = yshapesRef.current.get(shape.id)
          if (!existing || JSON.stringify(existing) !== JSON.stringify(shape)) {
            yshapesRef.current.set(shape.id, shape)
          }
        })
      })
    }
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

  const handleMouseDown = (e: any) => {
    const stage = stageRef.current
    if (!stage) return
    const p = pointerToCanvas(stage)
    if (!p) return
    if (activeTool === 'select') {
      if (editingId) { finishEditing(); return; }
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
          if (e.evt.shiftKey) {
            setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id])
          } else {
            setSelectedIds(prev => prev.includes(id) ? prev : [id])
          }
        }
      }
      return
    }
    if (activeTool === 'text') {
      const id = uid()
      const newTextShape: TextShape = {
        id, type: 'text', x: p.x, y: p.y, text: '', fontSize: 24, stroke, fill: '#00000000', strokeWidth, roughness, fillStyle, angle: 0,
      }
      setShapes([...shapes, newTextShape])
      setEditingId(id)
      setEditingText('')
      return
    }
    if (activeTool === 'pan') return
    drawSnapshotRef.current = shapes
    setIsDrawing(true)
    const id = uid()
    if (activeTool === 'rect') draftRef.current = { id, type: 'rect', x: p.x, y: p.y, width: 1, height: 1, stroke, fill, strokeWidth, roughness, fillStyle, angle: 0 }
    if (activeTool === 'ellipse') draftRef.current = { id, type: 'ellipse', x: p.x, y: p.y, radiusX: 1, radiusY: 1, stroke, fill, strokeWidth, roughness, fillStyle, angle: 0 }
    if (activeTool === 'line') draftRef.current = { id, type: 'line', points: [p.x, p.y, p.x, p.y], stroke, fill, strokeWidth, roughness, fillStyle, angle: 0 }
    if (activeTool === 'arrow') draftRef.current = { id, type: 'arrow', points: [p.x, p.y, p.x, p.y], stroke, fill, strokeWidth, roughness, fillStyle, angle: 0 }
    if (activeTool === 'draw') draftRef.current = { id, type: 'draw', points: [p.x, p.y], stroke, fill: '#00000000', strokeWidth, roughness, fillStyle, angle: 0 }
    if (draftRef.current) setShapes([...shapes, draftRef.current])
  }

  const handleMouseMove = () => {
    const stage = stageRef.current
    if (!stage) return
    const p = pointerToCanvas(stage)
    if (!p) return
    if (roomId) updateAwareness(p.x, p.y)
    if (isSelecting && selectionRect) {
      setSelectionRect(prev => prev ? ({ ...prev, width: p.x - prev.x, height: p.y - prev.y }) : null)
      return
    }
    if (!isDrawing || !draftRef.current) return
    setShapes((prev) => {
      const next = [...prev]
      const idx = next.findIndex((s) => s.id === draftRef.current?.id)
      if (idx < 0) return prev
      const shape = next[idx]
      if (shape.type === 'rect') next[idx] = { ...shape, width: p.x - shape.x, height: p.y - shape.y }
      else if (shape.type === 'ellipse') next[idx] = { ...shape, radiusX: Math.abs(p.x - shape.x), radiusY: Math.abs(p.y - shape.y) }
      else if (shape.type === 'line' || shape.type === 'arrow') next[idx] = { ...shape, points: [shape.points[0], shape.points[1], p.x, p.y] }
      else if (shape.type === 'draw') next[idx] = { ...shape, points: [...shape.points, p.x, p.y] }
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
        if (s.type === 'rect' || s.type === 'text') return s.x >= x1 && s.x <= x2 && s.y >= y1 && s.y <= y2
        if (s.type === 'ellipse') return (s.x - s.radiusX) >= x1 && (s.x + s.radiusX) <= x2 && (s.y - s.radiusY) >= y1 && (s.y + s.radiusY) <= y2
        if (s.type === 'line' || s.type === 'arrow' || s.type === 'draw') return s.points.some((p, i) => i % 2 === 0 ? (p >= x1 && p <= x2) : (p >= y1 && p <= y2))
        return false
      }).map(s => s.id)
      setSelectedIds(boxSelected)
      setIsSelecting(false)
      setSelectionRect(null)
      return
    }
    if (!isDrawing) return
    setIsDrawing(false)
    const finalShapes = shapes.map((shape) => {
      if (shape.id !== draftRef.current?.id) return shape
      if (shape.type === 'rect') {
        const nw = Math.abs(shape.width), nh = Math.abs(shape.height)
        return { ...shape, x: shape.width < 0 ? shape.x + shape.width : shape.x, y: shape.height < 0 ? shape.y + shape.height : shape.y, width: nw, height: nh }
      }
      return shape
    })
    if (drawSnapshotRef.current) commitScene(finalShapes, drawSnapshotRef.current)
    else setShapes(finalShapes)
    drawSnapshotRef.current = null
    draftRef.current = null
  }

  const undo = useCallback(() => {
    if (!history.length) return
    const prevScene = history[history.length - 1]
    setRedoStack((prev) => [shapes, ...prev].slice(0, SNAPSHOT_LIMIT))
    setHistory((prev) => prev.slice(0, -1))
    setShapes(prevScene)
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
    commitScene(shapes.filter((s) => !selectedIds.includes(s.id)))
    setSelectedIds([])
  }, [selectedIds, shapes])

  const finishEditing = useCallback(() => {
    if (!editingId) return
    const shape = shapes.find(s => s.id === editingId) as TextShape | undefined
    if (shape && editingText.trim() === '') setShapes(prev => prev.filter(s => s.id !== editingId))
    else {
      const nextShapes = shapes.map(s => s.id === editingId ? { ...s, text: editingText } : s)
      commitScene(nextShapes)
    }
    setEditingId(null)
    setEditingText('')
  }, [editingId, editingText, shapes])

  const exportJson = () => {
    const scene: Scene = { version: CURRENT_VERSION, shapes, appState: { stagePos, stageScale } }
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
      const shapesData = migrateScene(rawData)
      const validated = z.array(ShapeSchema).parse(shapesData)
      commitScene(validated)
      if (rawData.appState) {
        if (rawData.appState.stagePos) setStagePos(rawData.appState.stagePos)
        if (rawData.appState.stageScale) setStageScale(rawData.appState.stageScale)
      }
      setSelectedIds([])
    } catch (error) {
      alert('Invalid JSON file')
    } finally {
      event.target.value = ''
    }
  }

  const exportPng = () => {
    const dataUrl = stageRef.current?.toDataURL({ pixelRatio: 2 })
    if (dataUrl) {
      const anchor = document.createElement('a')
      anchor.href = dataUrl
      anchor.download = `drawing-${Date.now()}.png`
      anchor.click()
    }
  }

  const exportSvg = () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    const roughSvg = rough.svg(svg)
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
    const width = maxX - minX, height = maxY - minY
    svg.setAttribute('width', width.toString())
    svg.setAttribute('height', height.toString())
    svg.setAttribute('viewBox', `${minX} ${minY} ${width} ${height}`)
    svg.setAttribute('style', 'background-color: transparent;')
    shapes.forEach(shape => {
      const options = { stroke: shape.stroke, strokeWidth: shape.strokeWidth, roughness: shape.roughness, fill: shape.fill === '#00000000' ? undefined : shape.fill, fillStyle: shape.fillStyle }
      let node: SVGElement | null = null
      if (shape.type === 'rect') node = roughSvg.rectangle(shape.x, shape.y, shape.width, shape.height, options)
      else if (shape.type === 'ellipse') node = roughSvg.ellipse(shape.x, shape.y, shape.radiusX * 2, shape.radiusY * 2, options)
      else if (shape.type === 'line' || shape.type === 'arrow') {
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
        textNode.setAttribute('x', shape.x.toString()); textNode.setAttribute('y', (shape.y + shape.fontSize).toString()); textNode.setAttribute('font-family', 'sans-serif'); textNode.setAttribute('font-size', shape.fontSize.toString()); textNode.setAttribute('fill', shape.stroke); if (shape.angle) textNode.setAttribute('transform', `rotate(${shape.angle}, ${shape.x}, ${shape.y})`); textNode.textContent = shape.text; node = textNode
      }
      if (node) {
        if (shape.angle && shape.type !== 'text') {
          let cx = 0, cy = 0
          if (shape.type === 'rect' || shape.type === 'ellipse') { cx = shape.x; cy = shape.y } else { cx = shape.points[0]; cy = shape.points[1] }
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

  const shareDrawing = async () => {
    try {
      setShareState('publishing')
      const response = await fetch(JSONBLOB_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(shapes) })
      if (!response.ok) throw new Error('Share failed')
      const location = response.headers.get('Location')
      const blobId = location?.split('/').pop()
      if (!blobId) throw new Error('No blob id')
      const shareUrl = `${window.location.origin}${window.location.pathname}?blob=${blobId}`
      if (navigator.share && window.innerWidth < 900) await navigator.share({ title: 'ClawCanvas scene', text: 'Open this drawing', url: shareUrl })
      else await navigator.clipboard.writeText(shareUrl)
      setShareState('copied')
      setTimeout(() => setShareState('idle'), 2200)
    } catch (error) {
      console.error(error)
      const fallback = `${window.location.origin}${window.location.pathname}?drawing=${encodeDrawing(shapes)}`
      await navigator.clipboard.writeText(fallback)
      setShareState('failed'); setTimeout(() => setShareState('idle'), 2500)
    }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isCommandPaletteOpen) {
        if (event.key === 'Escape') setIsCommandPaletteOpen(false)
        return
      }
      if (editingId) {
        if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); finishEditing(); }
        if (event.key === 'Escape') finishEditing()
        return
      }
      const target = event.target as HTMLElement | null
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable) return
      if (event.code === 'Space') { event.preventDefault(); setSpacePan(true); return; }
      const key = event.key.toLowerCase(), isMod = event.metaKey || event.ctrlKey
      if (isMod && key === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo(); return; }
      if (isMod && key === 'y') { event.preventDefault(); redo(); return; }
      if (isMod && key === 'k') { event.preventDefault(); setIsCommandPaletteOpen(prev => !prev); setCommandSearch(''); return; }
      if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); removeSelected(); return; }
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
    const onKeyUp = (event: KeyboardEvent) => { if (event.code === 'Space') setSpacePan(false); }
    const onPaste = (event: ClipboardEvent) => {
      const text = event.clipboardData?.getData('text')
      if (text && activeTool === 'text') {
        const stage = stageRef.current; if (!stage) return;
        const p = pointerToCanvas(stage) || { x: 100, y: 100 }
        const id = uid()
        const newTextShape: TextShape = { id, type: 'text', x: p.x, y: p.y, text, fontSize: 24, stroke, fill: '#00000000', strokeWidth, roughness, fillStyle, angle: 0 }
        commitScene([...shapes, newTextShape])
      }
    }
    window.addEventListener('keydown', onKeyDown); window.addEventListener('keyup', onKeyUp); window.addEventListener('paste', onPaste)
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); window.removeEventListener('paste', onPaste); }
  }, [redo, removeSelected, undo, zoomByStep, activeTool, shapes, stroke, strokeWidth, roughness, fillStyle, editingId, finishEditing, isCommandPaletteOpen])

  const centerScene = () => {
    if (shapes.length === 0) { setStagePos({ x: 0, y: 0 }); setStageScale(1); return; }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    shapes.forEach(s => {
      if (s.type === 'rect' || s.type === 'text') { minX = Math.min(minX, s.x); minY = Math.min(minY, s.y); maxX = Math.max(maxX, s.x + (s.type === 'rect' ? s.width : 100)); maxY = Math.max(maxY, s.y + (s.type === 'rect' ? s.height : 24)); }
      else if (s.type === 'ellipse') { minX = Math.min(minX, s.x - s.radiusX); minY = Math.min(minY, s.y - s.radiusY); maxX = Math.max(maxX, s.x + s.radiusX); maxY = Math.max(maxY, s.y + s.radiusY); }
      else { for (let i = 0; i < s.points.length; i += 2) { minX = Math.min(minX, s.points[i]); minY = Math.min(minY, s.points[i+1]); maxX = Math.max(maxX, s.points[i]); maxY = Math.max(maxY, s.points[i+1]); } }
    })
    const centerX = (minX + maxX) / 2, centerY = (minY + maxY) / 2
    setStagePos({ x: viewport.width / 2 - centerX * stageScale, y: viewport.height / 2 - centerY * stageScale })
  }

  const COMMANDS = [
    { id: 'center', label: 'Center Scene', icon: MousePointer2, action: () => centerScene() },
    { id: 'clear', label: 'Clear Canvas', icon: Trash2, action: () => { if (confirm('Clear everything?')) commitScene([]); } },
    { id: 'export_json', label: 'Export JSON', icon: Download, action: () => exportJson() },
    { id: 'export_svg', label: 'Export SVG', icon: FileCode, action: () => exportSvg() },
    { id: 'export_png', label: 'Export PNG', icon: ImageDown, action: () => exportPng() },
    { id: 'toggle_grid', label: 'Toggle Grid', icon: Grid3X3, action: () => setShowGrid(prev => !prev) },
    { id: 'toggle_dark', label: 'Toggle Dark Mode', icon: isDarkMode ? Sun : Moon, action: () => setIsDarkMode(prev => !prev) },
    { id: 'toggle_assets', label: 'Toggle Asset Library', icon: Layout, action: () => setShowAssets(prev => !prev) },
    { id: 'collab', label: 'Start Collaboration', icon: Users, action: () => joinOrCreateRoom() },
  ]

  const filteredCommands = COMMANDS.filter(c => c.label.toLowerCase().includes(commandSearch.toLowerCase()))

  return (
    <div className={`workspace-shell ${isDarkMode ? 'dark-theme' : ''}`}>
      {showAssets && (
        <aside className="assets-sidebar panel">
          <div className="sidebar-header"><h3>Asset Library</h3><button className="icon-btn" onClick={() => setShowAssets(false)}><Trash2 size={14} /></button></div>
          <div className="assets-grid">
            {DEFAULT_ASSETS.map(asset => (
              <div key={asset.id} className="asset-item" draggable onDragStart={(e) => e.dataTransfer.setData('claw_asset', JSON.stringify(asset))} onClick={() => { const id = uid(); const shape: any = { ...asset, id, x: 100, y: 100, label: undefined }; commitScene([...shapes, shape]) }}>
                <div className="asset-preview" style={{ background: asset.fill === '#00000000' ? '#eee' : asset.fill, borderColor: asset.stroke }}></div>
                <span>{asset.label}</span>
              </div>
            ))}
          </div>
        </aside>
      )}
      {isCommandPaletteOpen && (
        <div className="command-palette-overlay" onClick={() => setIsCommandPaletteOpen(false)}>
          <div className="command-palette" onClick={e => e.stopPropagation()}>
            <div className="command-search-wrapper"><Command size={18} /><input autoFocus placeholder="Type a command..." value={commandSearch} onChange={e => setCommandSearch(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && filteredCommands.length > 0) { filteredCommands[0].action(); setIsCommandPaletteOpen(false); } }} /></div>
            <div className="command-list">{filteredCommands.map(c => (<div key={c.id} className="command-item" onClick={() => { c.action(); setIsCommandPaletteOpen(false); }}><c.icon size={16} /><span>{c.label}</span></div>))}{filteredCommands.length === 0 && <div className="command-empty">No commands found</div>}</div>
          </div>
        </div>
      )}
      {editingId && (
        <textarea autoFocus className="inline-text-editor"
          style={{ position: 'absolute', top: ((shapes.find(s => s.id === editingId) as TextShape)?.y || 0) * stageScale + stagePos.y, left: ((shapes.find(s => s.id === editingId) as TextShape)?.x || 0) * stageScale + stagePos.x, fontSize: ((shapes.find(s => s.id === editingId) as TextShape)?.fontSize || 24) * stageScale, color: ((shapes.find(s => s.id === editingId) as TextShape)?.stroke || '#000'), transform: `rotate(${(shapes.find(s => s.id === editingId) as TextShape)?.angle || 0}deg)`, transformOrigin: 'top left' }}
          value={editingText} onChange={(e) => setEditingText(e.target.value)} onBlur={finishEditing}
        />
      )}
      <Stage ref={(node) => { stageRef.current = node }} className={`stage ${showGrid ? 'show-grid' : ''}`} width={viewport.width} height={viewport.height} draggable={activeTool === 'pan'} x={stagePos.x} y={stagePos.y} scaleX={stageScale} scaleY={stageScale} 
        onDragEnd={(e) => setStagePos({ x: e.target.x(), y: e.target.y() })} 
        onWheel={(e) => { e.evt.preventDefault(); const p = stageRef.current?.getPointerPosition(); if (p) setZoomAroundPoint(stageScale + (e.evt.deltaY > 0 ? -1 : 1) * 0.08, p); }} 
        onMouseDown={(e) => handleMouseDown(e)} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} 
        onDragOver={(e: any) => e.evt.preventDefault()}
        onDrop={(e: any) => {
          e.evt.preventDefault()
          const data = e.evt.dataTransfer?.getData('claw_asset')
          if (data && stageRef.current) {
            const asset = JSON.parse(data)
            const p = pointerToCanvas(stageRef.current) || { x: 100, y: 100 }
            const id = uid()
            const shape: any = { ...asset, id, x: p.x, y: p.y, label: undefined }
            commitScene([...shapes, shape])
          }
        }}
        onTouchStart={() => setTouchStatus('Drawing...')} onTouchEnd={() => setTouchStatus(null)}>
        <Layer>
          {shapes.map((shape) => {
            const isSelected = selectedIds.includes(shape.id)
            if (shape.type === 'text') {
              return (
                <Text key={shape.id} id={shape.id} x={shape.x} y={shape.y} rotation={shape.angle} text={shape.text} fontSize={shape.fontSize} fill={shape.stroke} draggable={activeTool === 'select' && isSelected}
                  onDragEnd={(e) => { if (e.target !== e.currentTarget) return; commitScene(shapes.map(s => s.id === shape.id ? { ...s, x: e.target.x(), y: e.target.y() } : s)) }}
                  onTransformEnd={(e) => { const node = e.target; commitScene(shapes.map(s => s.id === shape.id ? { ...s, x: node.x(), y: node.y(), fontSize: (s as TextShape).fontSize * node.scaleX(), angle: node.rotation() } : s)); node.scaleX(1); node.scaleY(1); }}
                  onDblClick={() => { setEditingId(shape.id); setEditingText(shape.text); }}
                  onClick={(e) => { if (activeTool !== 'select') return; e.cancelBubble = true; }}
                />
              )
            }
            const common = {
              key: shape.id, id: shape.id, draggable: activeTool === 'select' && isSelected,
              onDragStart: () => { dragSnapshotRef.current = shapes },
              onDragEnd: (e: any) => { if (e.target !== e.currentTarget) return; const nx = e.target.x(), ny = e.target.y(); const next = shapes.map(s => { if (!selectedIds.includes(s.id)) return s; if (s.type === 'rect' || s.type === 'ellipse' || s.type === 'text') return { ...s, x: s.x + nx, y: s.y + ny }; return { ...s, points: s.points.map((p, i) => i % 2 === 0 ? p + nx : p + ny) }; }); if (dragSnapshotRef.current) commitScene(next, dragSnapshotRef.current); else setShapes(next); dragSnapshotRef.current = null; e.target.position({ x: 0, y: 0 }); },
              onTransformEnd: (e: any) => { const node = e.target; const next = shapes.map(s => { if (s.id !== shape.id) return s; if (s.type === 'rect') return { ...s, x: node.x(), y: node.y(), width: s.width * node.scaleX(), height: s.height * node.scaleY(), angle: node.rotation() }; if (s.type === 'ellipse') return { ...s, x: node.x(), y: node.y(), radiusX: s.radiusX * node.scaleX(), radiusY: s.radiusY * node.scaleY(), angle: node.rotation() }; return s; }); commitScene(next); node.scaleX(1); node.scaleY(1); },
              onClick: (e: any) => { if (activeTool !== 'select') return; e.cancelBubble = true; },
              sceneFunc: (context: any, shapeNode: any) => {
                shapeNode.name('konva-shape')
                const roughCanvas = rough.canvas(context.canvas._canvas)
                const options = { stroke: shape.stroke, strokeWidth: shape.strokeWidth, roughness: shape.roughness, fill: shape.fill === '#00000000' ? undefined : shape.fill, fillStyle: shape.fillStyle }
                const ctx = context._context
                ctx.save()
                // We don't apply matrix here because roughCanvas draws directly to the canvas element.
                // Instead, we just let Konva do its thing and use absolute positions for now.
                // TODO: Proper relative drawing in Phase 6.
                if (shape.type === 'rect') roughCanvas.draw(generator.rectangle(shape.x, shape.y, shape.width, shape.height, options))
                else if (shape.type === 'ellipse') roughCanvas.draw(generator.ellipse(shape.x, shape.y, shape.radiusX * 2, shape.radiusY * 2, options))
                else if (shape.type === 'line' || shape.type === 'arrow') { 
                  roughCanvas.draw(generator.line(shape.points[0], shape.points[1], shape.points[2], shape.points[3], options))
                  if (shape.type === 'arrow') {
                    const x1 = shape.points[0], y1 = shape.points[1], x2 = shape.points[2], y2 = shape.points[3], angle = Math.atan2(y2 - y1, x2 - x1), headLength = 15
                    roughCanvas.draw(generator.line(x2, y2, x2 - headLength * Math.cos(angle - Math.PI / 6), y2 - headLength * Math.sin(angle - Math.PI / 6), options))
                    roughCanvas.draw(generator.line(x2, y2, x2 - headLength * Math.cos(angle + Math.PI / 6), y2 - headLength * Math.sin(angle + Math.PI / 6), options))
                  }
                }
                else if (shape.type === 'draw') { const pts: [number, number][] = []; for (let i = 0; i < shape.points.length; i += 2) pts.push([shape.points[i], shape.points[i+1]]); roughCanvas.draw(generator.curve(pts, options)) }
                ctx.restore()
                context.fillStrokeShape(shapeNode)
              }
            }
            return <KonvaShape {...common} />
          })}
          {selectedIds.length > 0 && activeTool === 'select' && <Transformer ref={transformerRef} boundBoxFunc={(oldBox, newBox) => (Math.abs(newBox.width) < 5 || Math.abs(newBox.height) < 5) ? oldBox : newBox} />}
          {selectionRect && <KonvaShape sceneFunc={(context) => rough.canvas(context.canvas._canvas).draw(generator.rectangle(selectionRect.x, selectionRect.y, selectionRect.width, selectionRect.height, { stroke: '#4f46e5', strokeWidth: 1, fill: 'rgba(79, 70, 229, 0.1)', fillStyle: 'solid', roughness: 0 }))} />}
          {Array.from(peers.entries()).map(([id, user]) => <KonvaShape key={id} sceneFunc={(context) => { context.beginPath(); context.fillStyle = '#4f46e5'; context.moveTo(user.x, user.y); context.lineTo(user.x + 10, user.y + 20); context.lineTo(user.x + 20, user.y + 10); context.closePath(); context.fill(); context.font = '12px sans-serif'; context.fillText(user.name, user.x + 20, user.y + 30); }} />)}
        </Layer>
      </Stage>
      <header className="top-bar panel"><div className="brand"><div className="brand-dot" /><div><strong>ClawCanvas</strong><p>Agentic sketchpad powered by OpenClaw</p></div></div><div className="actions">{roomId ? <div className="room-indicator"><Users size={16} /><span>Room: {roomId}</span></div> : <button className="action-button primary" onClick={joinOrCreateRoom}><Users size={16} /> Live Collab</button>}<button className="action-button" onClick={undo} title="Undo (Ctrl/Cmd + Z)"><Undo2 size={16} /> Undo</button><button className="action-button" onClick={redo} title="Redo (Ctrl/Cmd + Y)"><Redo2 size={16} /> Redo</button><button className="action-button" onClick={shareDrawing}><Share2 size={16} />{shareState === 'publishing' ? 'Publishing...' : shareState === 'copied' ? 'Link copied' : shareState === 'failed' ? 'Fallback copied' : 'Share'}</button><button className="action-button" onClick={exportPng}><ImageDown size={16} /> PNG</button><button className="action-button" onClick={exportSvg}><FileCode size={16} /> SVG</button><button className="action-button" onClick={exportJson}><Download size={16} /> JSON</button><label className="action-button upload"><Upload size={16} /> Import<input type="file" accept="application/json" onChange={importJson} /></label><button className="action-button danger" onClick={() => { if (!shapes.length) return; commitScene([]); setSelectedIds([]); }}><Trash2 size={16} /> Clear</button></div></header>
      <aside className="left-rail panel">{TOOL_DEFINITIONS.map((entry) => { const Icon = entry.icon; return <button key={entry.id} className={`rail-button ${activeTool === entry.id ? 'active' : ''}`} onClick={() => setTool(entry.id)} title={`${entry.label} (${entry.shortcut})`}><Icon size={18} /><span>{entry.shortcut}</span></button> })}</aside>
      <aside className="right-panel panel"><h3>Properties</h3><p>{selectedIds.length > 0 ? `Selected: ${selectedIds.length} objects` : 'No shape selected'}</p><div className="control-row"><label>Stroke</label><input type="color" value={stroke} onChange={(e) => { const next = e.target.value; setStroke(next); if (selectedIds.length > 0) setShapes(prev => prev.map(s => selectedIds.includes(s.id) ? { ...s, stroke: next } : s)) }} /></div><div className="control-row"><label>Fill</label><input type="color" value={fill === '#00000000' ? '#ffffff' : fill} onChange={(e) => { const next = e.target.value; setFill(next); if (selectedIds.length > 0) setShapes(prev => prev.map(s => selectedIds.includes(s.id) ? { ...s, fill: next } : s)) }} /></div><div className="control-column"><label>Stroke width: {strokeWidth}px</label><input type="range" min={1} max={12} value={strokeWidth} onChange={(e) => { const next = Number(e.target.value); setStrokeWidth(next); if (selectedIds.length > 0) setShapes(prev => prev.map(s => selectedIds.includes(s.id) ? { ...s, strokeWidth: next } : s)) }} /></div><div className="control-column"><label>Roughness: {roughness}</label><input type="range" min={0} max={5} step={0.5} value={roughness} onChange={(e) => { const next = Number(e.target.value); setRoughness(next); if (selectedIds.length > 0) setShapes(prev => prev.map(s => selectedIds.includes(s.id) ? { ...s, roughness: next } : s)) }} /></div><div className="control-column"><label>Fill Style</label><select value={fillStyle} onChange={(e) => { const next = e.target.value as Shape['fillStyle']; setFillStyle(next); if (selectedIds.length > 0) setShapes(prev => prev.map(s => selectedIds.includes(s.id) ? { ...s, fillStyle: next } : s)) }} className="action-button full"><option value="hachure">Hachure</option><option value="solid">Solid</option><option value="zigzag">Zigzag</option><option value="cross-hatch">Cross-hatch</option><option value="dots">Dots</option><option value="sunburst">Sunburst</option></select></div><div className="control-column"><label>Zoom: {Math.round(stageScale * 100)}%</label><div className="zoom-actions"><button className="action-button" onClick={() => zoomByStep(-1)}><ZoomOut size={15} /></button><button className="action-button" onClick={() => zoomByStep(1)}><ZoomIn size={15} /></button></div></div>{selectedIds.length > 0 && <button className="action-button danger full" onClick={removeSelected}><Trash2 size={15} /> Delete selected</button>}</aside>
      <footer className="bottom-hud panel"><div className="hud-hints"><span>Space = temporary pan</span><span>V/H/R/O/L/A/P/T = quick tools</span><span>{shapes.length} objects</span>{touchStatus && <span className="touch-badge">{touchStatus}</span>}</div><div className="credits">made with <strong>OpenClaw</strong> &lt;3 <strong>RJ</strong></div></footer>
    </div>
  )
}
