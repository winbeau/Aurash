import type * as React from 'react'
import { useEffect, useState } from 'react'

/**
 * useDragScroll —— 共享「鼠标左键拖拽平移」hook（PdfViewer / DocxViewer / ImageViewer 复用）。
 *
 * 设计要点（对齐预览缩放居中修复方案）：
 * - 在 `ref` 元素上挂原生 pointer 事件（非 React props）：与本仓 ImageViewer 现有
 *   `addEventListener('wheel', …, { passive:false })` 模式一致，需要原生监听才能精确控制
 *   `preventDefault` / pointer capture 时机。
 * - 自门控 `isOverflow()`：仅当内容溢出（scrollWidth>clientWidth || scrollHeight>clientHeight）
 *   才显示 grab 光标并允许拖拽——PDF 多页天然高，zoom=1 也能竖向平移；任意 viewer 放大超出
 *   容器宽后可横向平移。
 * - `threshold`（默认 4px）保留点击 + 原生文本选区：位移小于阈值时绝不 `preventDefault`、不
 *   捕获指针，浏览器照常处理点击/选区（docx 文本选择关键取舍）；越过阈值后才进入平移。
 * - reverse-follow：`scrollLeft = startScrollLeft - dx`，内容跟手拖动（像抓住纸张）。
 * - 光标 grab 仅在溢出时显示（ResizeObserver 在缩放/布局变化时刷新），否则清除（不误导）。
 */

export type UseDragScroll = {
  /** 是否正处于平移拖拽中（越过阈值后为 true）。 */
  dragging: boolean
}

export function useDragScroll(
  ref: React.RefObject<HTMLElement | null>,
  opts?: { enabled?: boolean; threshold?: number },
): UseDragScroll {
  const enabled = opts?.enabled ?? true
  const threshold = opts?.threshold ?? 4
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (!enabled) {
      el.style.cursor = ''
      return () => {
        el.style.cursor = ''
      }
    }

    let startX = 0
    let startY = 0
    let startL = 0
    let startT = 0
    let pointerId = -1
    let active = false
    let panning = false

    const isOverflow = () =>
      el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1

    const refreshCursor = () => {
      el.style.cursor = isOverflow() ? 'grab' : ''
    }

    refreshCursor()

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return // 仅左键
      if (!isOverflow()) return // 无可平移内容
      active = true
      panning = false
      pointerId = e.pointerId
      startX = e.clientX
      startY = e.clientY
      startL = el.scrollLeft
      startT = el.scrollTop
      // 此处不 setPointerCapture / preventDefault：等越过阈值再做，
      // 以免吞掉普通点击 / 文本选区起始。
    }

    const onPointerMove = (e: PointerEvent) => {
      if (!active || e.pointerId !== pointerId) return
      const dx = e.clientX - startX
      const dy = e.clientY - startY
      if (!panning) {
        if (Math.hypot(dx, dy) < threshold) return // 阈值内→忽略（保留点击/选区）
        panning = true
        setDragging(true)
        try {
          el.setPointerCapture(pointerId)
        } catch {
          /* 某些环境不支持 pointer capture，忽略 */
        }
        el.style.cursor = 'grabbing'
        el.style.userSelect = 'none'
      }
      e.preventDefault() // 仅在确实平移后才阻断（终止文本拖选）
      el.scrollLeft = startL - dx // reverse-follow：内容跟手
      el.scrollTop = startT - dy
    }

    const endPan = () => {
      if (!active) return
      active = false
      if (panning) {
        try {
          el.releasePointerCapture(pointerId)
        } catch {
          /* 已释放 / 不支持，忽略 */
        }
      }
      panning = false
      setDragging(false)
      el.style.userSelect = ''
      refreshCursor() // 回到 grab（或溢出消失时清空）
    }

    const onPointerUp = endPan
    const onPointerCancel = endPan
    const onLostCapture = endPan

    // 指针进入时按当前溢出态刷新光标：内容/缩放增长**不改变滚动容器自身盒子**，
    // ResizeObserver(el) 不会触发，故需在 hover 进入那一刻（正是光标需要正确的时机）
    // 重算 grab。比每帧 pointermove 读 scrollWidth（强制重排）更省。
    const onPointerEnter = () => {
      if (!panning) refreshCursor()
    }

    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerup', onPointerUp)
    el.addEventListener('pointercancel', onPointerCancel)
    el.addEventListener('lostpointercapture', onLostCapture)
    el.addEventListener('pointerenter', onPointerEnter)

    // 容器自身盒子尺寸变化（如分栏拖拽 / 窗口缩放）时重算光标。
    const ro = new ResizeObserver(refreshCursor)
    ro.observe(el)

    return () => {
      ro.disconnect()
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup', onPointerUp)
      el.removeEventListener('pointercancel', onPointerCancel)
      el.removeEventListener('lostpointercapture', onLostCapture)
      el.removeEventListener('pointerenter', onPointerEnter)
      el.style.cursor = ''
      el.style.userSelect = ''
    }
  }, [ref, enabled, threshold])

  return { dragging }
}
