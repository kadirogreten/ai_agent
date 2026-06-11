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
    // No fog — interior room scene
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
    // Soft hemisphere — warm ceiling / cool ground; sıcak lambalar için 1.1
    scene.add(new THREE.HemisphereLight(0xfff7ed, 0x334155, 1.1))

    // Primary directional — gün ışığı hissi, gölge yalnız burada
    const keyLight = new THREE.DirectionalLight(0xcbd5e1, 0.9)
    keyLight.position.set(5, 20, 10)
    keyLight.castShadow = true
    keyLight.shadow.mapSize.set(1024, 1024)
    keyLight.shadow.camera.far = 80
    keyLight.shadow.camera.left = keyLight.shadow.camera.bottom = -30
    keyLight.shadow.camera.right = keyLight.shadow.camera.top = 30
    keyLight.shadow.bias = -0.0003
    scene.add(keyLight)

    // Window daylight — angled from back-left (pencere yönü)
    const windowLight = new THREE.DirectionalLight(0xfff7ed, 0.5)
    windowLight.position.set(-8, 4, -22)
    windowLight.target.position.set(0, 0, 0)
    scene.add(windowLight)
    scene.add(windowLight.target)

    if (onSceneReady) onSceneReady(scene, camera, renderer)

    // ── Animation ──────────────────────────────────────────────────────
    const animate = () => {
      animIdRef.current = requestAnimationFrame(animate)
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
