// @ts-ignore – no type declarations
import { CanvasEventManager, PlayerWin } from 'minecraft-inventory-gui'
import { useEffect, useRef, useState, useCallback } from 'react'
import type { LoadedSave } from '../lib/containers'
import type { NbtCompound, NbtList, NbtByte, NbtShort, NbtValue } from '../lib/nbt'
import { TagType } from '../lib/nbt'
import { getItemCategory, CATEGORY_COLORS, getItemName } from '../lib/items'
import { getTextureUrl } from '../lib/texturePaths'
import { ENCHANT_BY_ID, toRoman } from '../lib/enchants'

// ── constants ─────────────────────────────────────────────────────────────────

const SCALE = 3
const CANVAS_W = 176 * SCALE
const CANVAS_H = 166 * SCALE
const ARMOR_SAVE_SLOTS = [103, 102, 101, 100] as const

// ── image loading ─────────────────────────────────────────────────────────────

const imgCache = new Map<string, HTMLImageElement>()
function loadImg(src: string): HTMLImageElement {
  if (imgCache.has(src)) return imgCache.get(src)!
  const img = new Image(); img.crossOrigin = 'anonymous'; img.src = src
  imgCache.set(src, img); return img
}

const PATH_MAP: Record<string, string> = {
  'gui/container/inventory': '/game/gui/container/inventory.png',
  'gui/container/container': '/game/gui/container/container.png',
}

function getImage(opts: { path?: string; _canvas?: HTMLCanvasElement; _img?: HTMLImageElement }): HTMLImageElement | HTMLCanvasElement | null {
  if (opts._img)    return opts._img
  if (opts._canvas) return opts._canvas
  const path = opts.path ?? ''
  if (PATH_MAP[path]) return loadImg(PATH_MAP[path])
  return loadImg(`https://raw.githubusercontent.com/PrismarineJS/minecraft-assets/master/data/1.13.2/${path}.png`)
}

// ── per-item CDN image loading ─────────────────────────────────────────────────

const itemImgCache = new Map<number, Map<'top' | 'bottom' | 'side', HTMLImageElement | 'pending' | 'failed'>>()
const loadCallbacks: Array<(id: number) => void> = []

function getItemImage(id: number): HTMLImageElement | null {
  return getItemImageFace(id, 'side') // this allows non isocube items to still render as flat sprites.
}

// ── isometric cube rendering ──────────────────────────────────────────────────

const FLAT_BLOCK_IDS = new Set([
  6, 27, 28, 29, 30, 33, 37, 38, 39, 40, 44, 50, 53, 65, 66, 67, 69,
  75, 76, 78, 81, 83, 85, 96, 101, 102, 106, 107, 108, 109, 111, 113,
  114, 126, 128, 131, 134, 135, 136, 139, 140, 143, 151, 156, 160, 163,
  164, 171, 175,
])

const isoCubeCache = new Map<number, HTMLCanvasElement>()
// clear on module reload (vite HMR) so scale changes take effect straight away
isoCubeCache.clear()

function makeIsoCube(
  topImg:  HTMLImageElement,
  leftImg: HTMLImageElement,
  rightImg: HTMLImageElement,
): HTMLCanvasElement {
  const S = 16 * SCALE
  const PAD = SCALE
  const c = document.createElement('canvas'); c.width = c.height = S
  const ctx = c.getContext('2d')!; ctx.imageSmoothingEnabled = false
  const inner = S - PAD * 2; const sc = inner / S
  ctx.save(); ctx.translate(PAD, PAD); ctx.scale(sc, sc)
  const T = SCALE

  // top face
  ctx.save(); ctx.transform(0.5*T, 0.25*T, -0.5*T, 0.25*T, S/2, 0)
  ctx.drawImage(topImg, 0, 0, 16, 16)
  ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(0, 0, 16, 16); ctx.restore()

  // left face
  ctx.save(); ctx.transform(0.5*T, 0.25*T, 0, 0.5*T, 0, S/4)
  ctx.drawImage(leftImg, 0, 0, 16, 16)
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, 0, 16, 16); ctx.restore()

  // right face
  ctx.save(); ctx.transform(0.5*T, -0.25*T, 0, 0.5*T, S/2, S/2)
  ctx.drawImage(rightImg, 0, 0, 16, 16)
  ctx.fillStyle = 'rgba(0,0,0,0.14)'; ctx.fillRect(0, 0, 16, 16); ctx.restore()

  ctx.restore(); return c
}

function getItemImageFace(id: number, face: 'top' | 'side'): HTMLImageElement | null {
  if (!itemImgCache.has(id)) itemImgCache.set(id, new Map())
  const faceMap = itemImgCache.get(id)!
  const cached = faceMap.get(face)
  if (cached === 'pending' || cached === 'failed') return null
  if (cached) return cached
  const url = getTextureUrl(id, face)
  if (!url) { faceMap.set(face, 'failed'); return null }
  faceMap.set(face, 'pending')
  const img = new Image(); img.crossOrigin = 'anonymous'
  img.onload  = () => { faceMap.set(face, img); loadCallbacks.forEach(cb => cb(id)) }
  img.onerror = () => { faceMap.set(face, 'failed') }
  img.src = url; return null
}

function getIsoIcon(id: number): HTMLCanvasElement | null {
  if (isoCubeCache.has(id)) return isoCubeCache.get(id)!

  const top   = getItemImageFace(id, 'top')
  const side  = getItemImageFace(id, 'side')


  if (!top || !side) return null

  const cube = makeIsoCube(top, side, side)
  isoCubeCache.set(id, cube); return cube
}

// ── fallback coloured tile ────────────────────────────────────────────────────

const fallbackCache = new Map<number, HTMLCanvasElement>()
function getFallback(id: number): HTMLCanvasElement {
  if (fallbackCache.has(id)) return fallbackCache.get(id)!
  const cat = getItemCategory(id); const color = CATEGORY_COLORS[cat]
  const c = document.createElement('canvas'); c.width = c.height = 16
  const ctx = c.getContext('2d')!
  const r = parseInt(color.slice(1,3),16), g = parseInt(color.slice(3,5),16), b = parseInt(color.slice(5,7),16)
  ctx.fillStyle = `rgba(${r},${g},${b},0.4)`; ctx.fillRect(0,0,16,16)
  ctx.strokeStyle = color; ctx.strokeRect(0.5,0.5,15,15)
  const name = getItemName(id); const words = name.split(' ').filter(Boolean)
  const abbr = words.length >= 2 ? (words[0][0]+words[1][0]).toUpperCase() : name.slice(0,2).toUpperCase()
  ctx.fillStyle = color; ctx.font = 'bold 6px sans-serif'
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(abbr, 8, 9)
  fallbackCache.set(id, c); return c
}

// ── getImageIcon ──────────────────────────────────────────────────────────────
// picks the best available icon for an item — iso cube for solid blocks, flat sprite for items, coloured tile as last resort

function getImageIcon(item: { type: number }) {
  const id = item.type; const name = getItemName(id)
  if (id < 256 && !FLAT_BLOCK_IDS.has(id)) {
    const cube = getIsoIcon(id)
    if (cube) return { path: `__iso_${id}__`, _canvas: cube, slice: [0,0,16*SCALE,16*SCALE] as [number,number,number,number], scale: 1/SCALE, tip: name }
    getItemImage(id)
  } else {
    const img = getItemImage(id)
    if (img) return { path: `__item_${id}__`, _img: img, slice: [0,0,16,16] as [number,number,number,number], scale: 1, tip: name }
  }
  return { path: `__fb_${id}__`, _canvas: getFallback(id), slice: [0,0,16,16] as [number,number,number,number], scale: 1, tip: name }
}

// ── enchantment glint ─────────────────────────────────────────────────────────

// draws a minecraft-style enchantment glint over a 16×16 slot
// two diagonal gradient bands scroll at slightly different speeds and are
// composited with `screen` blend to get that purple shimmer
function drawGlint(ctx: CanvasRenderingContext2D, x: number, y: number) {
  const t = performance.now() / 1200   // controls scroll speed
  ctx.save()
  ctx.beginPath(); ctx.rect(x, y, 16, 16); ctx.clip()
  ctx.globalCompositeOperation = 'screen'

  for (let pass = 0; pass < 2; pass++) {
    const phase = (t + pass * 0.4) % 1
    // diagonal drift — each band moves right and down over time
    const ox = (phase * 28) - 6
    const oy = (phase * 14) - 3
    const gx0 = x + ox - 10, gy0 = y + oy
    const gx1 = x + ox + 10, gy1 = y + oy + 5
    const grad = ctx.createLinearGradient(gx0, gy0, gx1, gy1)
    grad.addColorStop(0,    'rgba(100, 30, 220, 0)')
    grad.addColorStop(0.35, 'rgba(160, 80, 255, 0.28)')
    grad.addColorStop(0.5,  'rgba(210,140, 255, 0.45)')
    grad.addColorStop(0.65, 'rgba(160, 80, 255, 0.28)')
    grad.addColorStop(1,    'rgba(100, 30, 220, 0)')
    ctx.fillStyle = grad
    ctx.fillRect(x, y, 16, 16)
  }
  ctx.restore()
}

// ── nbt helpers ───────────────────────────────────────────────────────────────

interface EnchantData { id: number; lvl: number }
interface SlotData { slot: number; id: number; count: number; enchants: EnchantData[] }

function readInventory(tags: Record<string, NbtValue>): SlotData[] {
  const list = tags['Inventory']
  if (!list || list.type !== TagType.List) return []
  return (list as NbtList).items
    .filter(it => it.type === TagType.Compound)
    .map(it => {
      const t = (it as NbtCompound).tags
      const enchants: EnchantData[] = []
      const tagComp = t['tag']
      if (tagComp?.type === TagType.Compound) {
        const enchList = (tagComp as NbtCompound).tags['ench']
        if (enchList?.type === TagType.List) {
          ;(enchList as NbtList).items.forEach(e => {
            if (e.type !== TagType.Compound) return
            const et = (e as NbtCompound).tags
            enchants.push({
              id:  et['id']?.type  === TagType.Short ? (et['id']  as NbtShort).value : 0,
              lvl: et['lvl']?.type === TagType.Short ? (et['lvl'] as NbtShort).value : 1,
            })
          })
        }
      }
      return {
        slot:    t['Slot']?.type  === TagType.Byte  ? (t['Slot']  as NbtByte).value  : 0,
        id:      t['id']?.type    === TagType.Short ? (t['id']    as NbtShort).value : 0,
        count:   t['Count']?.type === TagType.Byte  ? (t['Count'] as NbtByte).value  : 1,
        enchants,
      }
    })
}

function makeItem(slot: SlotData | undefined) {
  if (!slot) return null
  return {
    type:        slot.id,
    count:       slot.count > 1 ? slot.count : '',
    displayName: getItemName(slot.id),
    enchants:    slot.enchants,
  }
}

function containerIndexToSaveSlot(container: string, idx: number): number | null {
  if (container === 'hotbarItems')    return idx
  if (container === 'inventoryItems') return idx + 9
  if (container === 'armorItems')     return ARMOR_SAVE_SLOTS[idx] ?? null
  return null
}

// ── component ─────────────────────────────────────────────────────────────────

interface Props {
  loaded: LoadedSave
  onEditSlot: (slot: number) => void
  onSwapSlots: (src: number, dst: number) => void
}

interface TooltipLine { text: string; color: string }
interface TooltipState { visible: boolean; lines: TooltipLine[]; x: number; y: number }

interface DragSrc { slot: number; item: Record<string, unknown>; container: string; idx: number }

export default function InventoryCanvas({ loaded, onEditSlot, onSwapSlots }: Props) {
  const canvasRef  = useRef<HTMLCanvasElement>(null)
  const wrapRef    = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const winRef        = useRef<any>(null)
  const rafRef        = useRef<number>(0)
  const hasGlint      = useRef(false)
  const dragRef       = useRef<DragSrc | null>(null)
  const isDragging    = useRef(false)
  const dragTarget    = useRef<number | null>(null)
  const onSwapSlotsRef = useRef(onSwapSlots)
  const [tooltip, setTooltip] = useState<TooltipState>({ visible: false, lines: [], x: 0, y: 0 })

  // keep the ref in sync so the canvas event closure always calls the latest prop version
  useEffect(() => { onSwapSlotsRef.current = onSwapSlots }, [onSwapSlots])

  const cancelDrag = useCallback(() => {
    const win = winRef.current
    const src = dragRef.current
    if (src && win) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const arr = win[src.container] as any[]
      if (arr) { arr[src.idx] = src.item; (src.item as Record<string,unknown>).icon = undefined }
      win.floatingItem = null
      win.needsUpdate  = true
    }
    isDragging.current = false
    dragRef.current    = null
    dragTarget.current = null
    if (canvasRef.current) canvasRef.current.style.cursor = 'default'
  }, [])

  const onMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect) return
    const cx = e.clientX - rect.left
    const cy = e.clientY - rect.top

    if (!isDragging.current) {
      setTooltip(t => t.visible ? { ...t, x: cx + 12, y: cy } : t)
    }

    // start drag once the mouse moves with the left button held
    if (dragRef.current && !isDragging.current && e.buttons === 1) {
      const win = winRef.current
      if (win && dragRef.current.item) {
        isDragging.current = true
        win.floatingItem   = dragRef.current.item
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const arr = win[dragRef.current.container] as any[]
        if (arr) arr[dragRef.current.idx] = null
        setTooltip(t => ({ ...t, visible: false }))
        win.needsUpdate = true
        if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing'
      }
    }
  }, [])

  const onMouseLeave = useCallback(() => {
    if (isDragging.current) cancelDrag()
    else dragRef.current = null
    setTooltip(t => ({ ...t, visible: false }))
  }, [cancelDrag])

  useEffect(() => {
    if (!canvasRef.current) return
    const canvas = canvasRef.current
    canvas.width = CANVAS_W; canvas.height = CANVAS_H

    const manager = new CanvasEventManager(canvas)
    manager.setScale(SCALE)

    const win = new PlayerWin(manager, { getImage, getImageIcon })
    winRef.current = win

    // suppress the built-in canvas tooltip — we render our own react tooltip instead
    win.renderOverlays = function () {
      this._boxHighlights = this._boxHighlights.filter((box: number[]) => {
        const [x, y] = box
        // skips rendering of the crafting slots
        return !(x >= 98 && x <= 116 && y >= 18 && y <= 36)
      })

      for (const box of this._boxHighlights) this.drawBox(box)
      const { x, y } = this.can.lastCursorPosition
      if (this.floatingItem) this.drawItem(this.floatingItem, x - 8, y - 8)

      const ctx = this.drawCtx as CanvasRenderingContext2D
      ctx.save()
      ctx.fillStyle = '#c6c6c6'
      ctx.fillRect(98, 18, 58, 40)
      ctx.restore()
    }

    // patch drawItem to add stack count text and enchant glint on top of each icon
    win.drawItem = function (obj: Record<string, unknown>, x: number, y: number) {
      const icon = obj.icon ?? this.getImageIcon(obj)
      if (!icon) return
      obj.icon = obj.icon ?? icon
      this.drawImage(icon, x, y, (icon as Record<string,unknown>).slice, (icon as Record<string,unknown>).scale)

      const enchants = (obj.enchants as EnchantData[] | undefined) ?? []
      if (enchants.length > 0) {
        drawGlint(this.drawCtx as CanvasRenderingContext2D, x, y)
      }

      const count = obj.count
      if (count) {
        const ctx = this.drawCtx as CanvasRenderingContext2D
        ctx.save()
        ctx.font = '8px Mojangles, monospace'
        ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic'
        ctx.fillStyle = 'rgba(30,30,30,0.9)'
        ctx.fillText(String(count), x + 16.5, y + 16.5)
        ctx.fillStyle = '#ffffff'
        ctx.fillText(String(count), x + 16, y + 16)
        ctx.restore()
      }
    }

    // item events from the canvas lib: click = mousedown, hover = mousemove, release = mouseup
    win.on('itemEvent', (_id: string, type: string, _pos: unknown, data: [string, number]) => {
      if (type === 'click') {
        const [container, idx] = data
        const slot = containerIndexToSaveSlot(container, idx)
        const item = win[container]?.[idx]
        // store drag source — whether this turns into a drag or a click is decided later
        if (slot !== null && item) {
          dragRef.current = { slot, item, container, idx }
        }
        return
      }

      if (type === 'hover') {
        const [container, idx] = data
        const slot = containerIndexToSaveSlot(container, idx)
        if (isDragging.current) {
          // track which slot the user is hovering over as a potential drop target
          dragTarget.current = slot
          return
        }
        const item = win[container]?.[idx]
        if (item?.displayName) {
          const lines: TooltipLine[] = [
            { text: item.displayName, color: '#55ffff' },
          ]
          const enchants: EnchantData[] = item.enchants ?? []
          enchants.forEach(e => {
            const def = ENCHANT_BY_ID[e.id]
            const name = def?.name ?? `Enchantment ${e.id}`
            const lvl  = def && def.maxLevel > 1 ? ' ' + toRoman(e.lvl) : ''
            lines.push({ text: name + lvl, color: '#ffffff' })
          })
          setTooltip(t => ({ ...t, visible: true, lines }))
        }
        return
      }

      if (type === 'release') {
        setTooltip(t => ({ ...t, visible: false }))

        if (isDragging.current) {
          const src = dragRef.current
          const dst = dragTarget.current
          win.floatingItem = null
          isDragging.current = false
          dragRef.current    = null
          dragTarget.current = null
          if (canvasRef.current) canvasRef.current.style.cursor = 'default'

          if (src && dst !== null && dst !== src.slot) {
            // dropped on a different slot — swap via nbt update, win arrays are resynced by the next render
            onSwapSlotsRef.current(src.slot, dst)
          } else if (src) {
            // dropped back on the same slot — just restore the item visually
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const arr = win[src.container] as any[]
            if (arr) { arr[src.idx] = src.item; (src.item as Record<string,unknown>).icon = undefined }
            win.needsUpdate = true
          }
        } else if (dragRef.current) {
          // mouse didn't move enough to be a drag — treat as a click to open the edit panel
          const slot = dragRef.current.slot
          dragRef.current = null
          onEditSlot(slot)
        } else {
          dragRef.current = null
        }
      }
    })

    // when a CDN texture finishes loading, clear the icon cache for that item and force a redraw
    const onImgLoad = (id: number) => {
      isoCubeCache.delete(id)
      const clear = (arr: unknown[]) => arr?.forEach(it => {
        if (it && (it as Record<string,unknown>).type === id)
          (it as Record<string,unknown>).icon = undefined
      })
      clear(win.hotbarItems); clear(win.inventoryItems); clear(win.armorItems)
      win.needsUpdate = true
    }
    loadCallbacks.push(onImgLoad)

    manager.startRendering()

    // poll for a few seconds after mount so textures that load async appear quickly
    const poll = setInterval(() => { if (winRef.current) winRef.current.needsUpdate = true }, 300)
    setTimeout(() => clearInterval(poll), 5000)

    // continuous animation loop — only marks dirty when there's actually a glint to render
    const glintLoop = () => {
      if (hasGlint.current && winRef.current) winRef.current.needsUpdate = true
      rafRef.current = requestAnimationFrame(glintLoop)
    }
    rafRef.current = requestAnimationFrame(glintLoop)

    return () => {
      clearInterval(poll)
      cancelAnimationFrame(rafRef.current)
      const i = loadCallbacks.indexOf(onImgLoad)
      if (i !== -1) loadCallbacks.splice(i, 1)
      manager.stopRendering()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // sync inventory items into the canvas lib whenever the loaded save changes
  useEffect(() => {
    const win = winRef.current; if (!win) return
    const items  = readInventory(loaded.playerNbt.root.tags)
    const bySlot = new Map(items.map(i => [i.slot, i]))
    win.hotbarItems    = Array.from({ length: 9  }, (_, i) => makeItem(bySlot.get(i)))
    win.inventoryItems = Array.from({ length: 27 }, (_, i) => makeItem(bySlot.get(i + 9)))
    win.armorItems     = ARMOR_SAVE_SLOTS.map(s   => makeItem(bySlot.get(s)))
    win.craftingItems  = []; win.resultItems = []; win.shieldItems = []
    const clear = (arr: unknown[]) => arr?.forEach(it => { if (it) (it as Record<string,unknown>).icon = undefined })
    clear(win.hotbarItems); clear(win.inventoryItems); clear(win.armorItems)
    // track whether any slot has enchants so the glint RAF loop can skip work when not needed
    hasGlint.current = items.some(i => i.enchants.length > 0)
    win.needsUpdate = true
  }, [loaded])

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-block' }} onMouseMove={onMouseMove} onMouseLeave={onMouseLeave}>
      <canvas ref={canvasRef} style={{ imageRendering: 'pixelated', display: 'block', cursor: 'default' }} />
      {tooltip.visible && tooltip.lines.length > 0 && (
        <div style={{
          position: 'absolute', left: tooltip.x, top: tooltip.y,
          transform: 'translateY(-100%)',
          pointerEvents: 'none', zIndex: 999,
          padding: '5px 8px',
          background: '#100010f2',
          border: '1px solid #5000a0',
          boxShadow: '0 0 0 1px #200040, inset 0 0 0 1px #200040',
          borderRadius: 2,
          fontFamily: "'Mojangles', monospace",
          whiteSpace: 'nowrap',
          lineHeight: 1.6,
        }}>
          {tooltip.lines.map((line, i) => (
            <div key={i} style={{
              fontSize:   i === 0 ? 14 : 12,
              color:      line.color,
              textShadow: i === 0 ? '1px 1px 0 #153f3f' : '1px 1px 0 #3f3f3f',
            }}>
              {line.text}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
