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

export function useOfficeCamera({ camera, renderer }: UseOfficeCameraProps) {
  const cameraStateRef = useRef<CameraState>({
    position: { x: 15, y: 7, z: 25 },
    target: { x: 0, y: 2, z: 0 },
    zoom: 1,
  })

  const mouseRef = useRef({ x: 0, y: 0, isDragging: false })

  useEffect(() => {
    if (!camera || !renderer) return

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

      // Vertical camera movement
      state.position.y = Math.max(2, Math.min(20, state.position.y + deltaY * 0.02))

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

    // Handle zoom with mouse wheel
    const onMouseWheel = (event: WheelEvent) => {
      event.preventDefault()

      const state = cameraStateRef.current
      const zoomSpeed = 0.1
      const minZoom = 0.5
      const maxZoom = 3

      state.zoom = Math.max(minZoom, Math.min(maxZoom, state.zoom + (event.deltaY > 0 ? zoomSpeed : -zoomSpeed)))

      const dx = state.position.x - state.target.x
      const dy = state.position.y - state.target.y
      const dz = state.position.z - state.target.z
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz)

      const newDistance = distance / state.zoom

      state.position.x = state.target.x + (dx / distance) * newDistance
      state.position.y = state.target.y + (dy / distance) * newDistance
      state.position.z = state.target.z + (dz / distance) * newDistance

      camera.position.set(state.position.x, state.position.y, state.position.z)
      camera.lookAt(state.target.x, state.target.y, state.target.z)
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
          // Reset camera
          state.position = { x: 15, y: 7, z: 25 }
          state.target = { x: 0, y: 2, z: 0 }
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
}
