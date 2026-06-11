import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useOfficeCamera } from '@/hooks/useOfficeCamera'

interface Office3DSceneProps {
  onSceneReady?: (scene: THREE.Scene, camera: THREE.Camera, renderer: THREE.WebGLRenderer) => void
  children?: React.ReactNode
}

export default function Office3DScene({ onSceneReady, children }: Office3DSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const sceneRef     = useRef<THREE.Scene | null>(null)
  const cameraRef    = useRef<THREE.PerspectiveCamera | null>(null)
  const rendererRef  = useRef<THREE.WebGLRenderer | null>(null)
  const animIdRef    = useRef<number | null>(null)
  const clockRef     = useRef(new THREE.Clock())

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const w = container.clientWidth
    const h = container.clientHeight

    // ── Scene ──────────────────────────────────────────────────────────
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x1e293b)   // slate-800 — slate-900 fazla siyah kalıyordu (R3)
    scene.fog = new THREE.FogExp2(0x1e293b, 0.004) // çok hafif derinlik; karartma yok (R3)
    sceneRef.current = scene

    // ── Camera ─────────────────────────────────────────────────────────
    const camera = new THREE.PerspectiveCamera(65, w / h, 0.1, 200)
    camera.position.set(0, 14, 18)
    camera.lookAt(0, 1, -4)
    cameraRef.current = camera

    // ── Renderer ───────────────────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
    renderer.setSize(w, h)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.4 // R3: koyu materyaller için pozlama artırıldı
    container.appendChild(renderer.domElement)
    rendererRef.current = renderer

    // ── Lighting ───────────────────────────────────────────────────────
    // Soft hemisphere — slate sky / dark ground, matches app palette
    scene.add(new THREE.HemisphereLight(0x94a3b8, 0x334155, 1.5)) // R3: zemin yansıması + şiddet artırıldı

    // Primary directional (soft shadows)
    const keyLight = new THREE.DirectionalLight(0xcbd5e1, 1.3)
    keyLight.position.set(5, 20, 10)
    keyLight.castShadow = true
    keyLight.shadow.mapSize.set(1024, 1024)
    keyLight.shadow.camera.far = 80
    keyLight.shadow.camera.left = keyLight.shadow.camera.bottom = -30
    keyLight.shadow.camera.right = keyLight.shadow.camera.top = 30
    keyLight.shadow.bias = -0.0003
    scene.add(keyLight)

    // Pastel sky-blue accent — left
    const blueLight = new THREE.PointLight(0x7dd3fc, 1.2, 35)
    blueLight.position.set(-18, 6, 0)
    scene.add(blueLight)

    // Pastel indigo accent — right
    const purpleLight = new THREE.PointLight(0xa5b4fc, 0.8, 30)
    purpleLight.position.set(18, 4, -8)
    scene.add(purpleLight)

    if (onSceneReady) onSceneReady(scene, camera, renderer)

    // ── Animation ──────────────────────────────────────────────────────
    const animate = () => {
      animIdRef.current = requestAnimationFrame(animate)
      const t = clockRef.current.getElapsedTime()

      // Very gentle pulse on accent lights
      blueLight.intensity   = 1.2 + Math.sin(t * 0.5) * 0.15
      purpleLight.intensity = 0.8 + Math.sin(t * 0.4 + 1) * 0.1

      renderer.render(scene, camera)
    }
    animate()

    // ── Resize ─────────────────────────────────────────────────────────
    const onResize = () => {
      const nw = container.clientWidth  || w
      const nh = container.clientHeight || h
      camera.aspect = nw / nh
      camera.updateProjectionMatrix()
      renderer.setSize(nw, nh)
    }
    window.addEventListener('resize', onResize)

    return () => {
      window.removeEventListener('resize', onResize)
      if (animIdRef.current !== null) cancelAnimationFrame(animIdRef.current)
      renderer.dispose()
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement)
      }
    }
  }, [onSceneReady])

  useOfficeCamera({ camera: cameraRef.current, renderer: containerRef.current })

  return (
    <div ref={containerRef} className="w-full h-full">
      {children}
    </div>
  )
}
