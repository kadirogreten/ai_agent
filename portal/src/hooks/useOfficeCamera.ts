import { useEffect, useRef } from 'react'
import * as THREE from 'three'

interface CameraState {
  position: { x: number; y: number; z: number }
  target: { x: number; y: number; z: number }
  zoom: number
}

interface UseOfficeCameraProps {
  camera: THREE.PerspectiveCamera | null
  renderer: HTMLElement | null
}

export interface OfficeCameraControls {
  zoomIn: () => void
  zoomOut: () => void
  resetView: () => void
}

export function useOfficeCamera({ camera, renderer }: UseOfficeCameraProps): OfficeCameraControls {
  const cameraStateRef = useRef<CameraState>({
    position: { x: 0, y: 14, z: 18 },
    target: { x: 0, y: 1, z: -4 },
    zoom: 1,
  })

  const mouseRef = useRef({ x: 0, y: 0, isDragging: false })
  // Zoom/reset fonksiyonları effect içinde camera'ya bağlanır; dışarıya ref üzerinden sunulur.
  const controlsRef = useRef<OfficeCameraControls>({ zoomIn: () => {}, zoomOut: () => {}, resetView: () => {} })

  useEffect(() => {
    if (!camera || !renderer) return

    // R5.2: mesafe-tabanlı zoom — eski "distance / kümülatif zoom" matematiği hem
    // yönü ters çeviriyor hem sıçramalı davranıyordu. factor > 1 = uzaklaş.
    const applyZoom = (factor: number) => {
      const state = cameraStateRef.current
      const dx = state.position.x - state.target.x
      const dy = state.position.y - state.target.y
      const dz = state.position.z - state.target.z
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz)
      const newDistance = Math.max(7, Math.min(42, distance * factor))
      const s = newDistance / distance
      state.position.x = state.target.x + dx * s
      state.position.y = state.target.y + dy * s
      state.position.z = state.target.z + dz * s
      camera.position.set(state.position.x, state.position.y, state.position.z)
      camera.lookAt(state.target.x, state.target.y, state.target.z)
    }

    const resetView = () => {
      const state = cameraStateRef.current
      state.position = { x: 0, y: 14, z: 18 }
      state.target = { x: 0, y: 1, z: -4 }
      state.zoom = 1
      camera.position.set(state.position.x, state.position.y, state.position.z)
      camera.lookAt(state.target.x, state.target.y, state.target.z)
    }

    controlsRef.current = {
      zoomIn:  () => applyZoom(0.85),
      zoomOut: () => applyZoom(1.18),
      resetView,
    }

    // Handle mouse movement for camera rotation
    const onMouseMove = (event: MouseEvent) => {
      if (!mouseRef.current.isDragging) return

      const deltaX = event.clientX - mouseRef.current.x
      const deltaY = event.clientY - mouseRef.current.y

      mouseRef.current.x = event.clientX
      mouseRef.current.y = event.clientY

      // Calculate new camera position by rotating around target
      const state = cameraStateRef.current
      const dx = state.position.x - state.target.x
      const dz = state.position.z - state.target.z
      const distance = Math.sqrt(dx * dx + dz * dz)

      let angle = Math.atan2(dz, dx)
      angle -= deltaX * 0.005 // Horizontal rotation sensitivity

      state.position.x = state.target.x + distance * Math.cos(angle)
      state.position.z = state.target.z + distance * Math.sin(angle)

      // Vertical camera movement (clamp y 5..25)
      state.position.y = Math.max(5, Math.min(25, state.position.y + deltaY * 0.02))

      camera.position.set(state.position.x, state.position.y, state.position.z)
      camera.lookAt(state.target.x, state.target.y, state.target.z)
    }

    const onMouseDown = (event: MouseEvent) => {
      if (event.button === 2) { // Right mouse button
        mouseRef.current.isDragging = true
        mouseRef.current.x = event.clientX
        mouseRef.current.y = event.clientY
      }
    }

    const onMouseUp = () => {
      mouseRef.current.isDragging = false
    }

    // Tekerlek: yukarı = yaklaş, aşağı = uzaklaş (R5.2 — yön düzeltildi)
    const onMouseWheel = (event: WheelEvent) => {
      event.preventDefault()
      applyZoom(event.deltaY > 0 ? 1.1 : 0.9)
    }

    // Handle keyboard for camera pan
    const onKeyDown = (event: KeyboardEvent) => {
      const state = cameraStateRef.current
      const panSpeed = 0.5

      switch (event.key) {
        case 'ArrowUp':
        case 'w':
        case 'W':
          state.target.z -= panSpeed
          break
        case 'ArrowDown':
        case 's':
        case 'S':
          state.target.z += panSpeed
          break
        case 'ArrowLeft':
        case 'a':
        case 'A':
          state.target.x -= panSpeed
          break
        case 'ArrowRight':
        case 'd':
        case 'D':
          state.target.x += panSpeed
          break
        case 'r':
        case 'R':
          state.position = { x: 0, y: 14, z: 18 }
          state.target = { x: 0, y: 1, z: -4 }
          state.zoom = 1
          break
        default:
          return
      }

      camera.position.set(state.position.x, state.position.y, state.position.z)
      camera.lookAt(state.target.x, state.target.y, state.target.z)
    }

    renderer.addEventListener('mousemove', onMouseMove)
    renderer.addEventListener('mousedown', onMouseDown)
    renderer.addEventListener('mouseup', onMouseUp)
    renderer.addEventListener('wheel', onMouseWheel, { passive: false })
    document.addEventListener('keydown', onKeyDown)

    return () => {
      renderer.removeEventListener('mousemove', onMouseMove)
      renderer.removeEventListener('mousedown', onMouseDown)
      renderer.removeEventListener('mouseup', onMouseUp)
      renderer.removeEventListener('wheel', onMouseWheel)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [camera, renderer])

  // Kararlı kimlikli API: delegeler controlsRef üzerinden hep güncel implementasyonu çağırır.
  // (Kararlı nesne — parent useEffect bağımlılığında döngü yaratmaz.)
  const apiRef = useRef<OfficeCameraControls>({
    zoomIn:    () => controlsRef.current.zoomIn(),
    zoomOut:   () => controlsRef.current.zoomOut(),
    resetView: () => controlsRef.current.resetView(),
  })
  return apiRef.current
}
