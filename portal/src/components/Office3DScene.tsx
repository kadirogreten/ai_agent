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
    scene.background = new THREE.Color(0x04080f)   // deep navy-black
    scene.fog = new THREE.FogExp2(0x04080f, 0.018) // atmospheric depth fog
    sceneRef.current = scene

    // ── Camera ─────────────────────────────────────────────────────────
    const camera = new THREE.PerspectiveCamera(65, w / h, 0.1, 200)
    camera.position.set(14, 9, 22)
    camera.lookAt(0, 1, 0)
    cameraRef.current = camera

    // ── Renderer ───────────────────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
    renderer.setSize(w, h)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 0.9
    container.appendChild(renderer.domElement)
    rendererRef.current = renderer

    // ── Lighting ───────────────────────────────────────────────────────
    // Very dim ambient — this is a moody, dramatic scene
    scene.add(new THREE.AmbientLight(0x0a1530, 0.6))

    // Primary overhead — cool blue-white
    const keyLight = new THREE.DirectionalLight(0x8ab4f8, 0.8)
    keyLight.position.set(5, 20, 10)
    keyLight.castShadow = true
    keyLight.shadow.mapSize.set(2048, 2048)
    keyLight.shadow.camera.far = 80
    keyLight.shadow.camera.left = keyLight.shadow.camera.bottom = -30
    keyLight.shadow.camera.right = keyLight.shadow.camera.top = 30
    keyLight.shadow.bias = -0.0003
    scene.add(keyLight)

    // Blue accent — left side
    const blueLight = new THREE.PointLight(0x3b82f6, 2.5, 35)
    blueLight.position.set(-18, 6, 0)
    scene.add(blueLight)

    // Purple accent — right side
    const purpleLight = new THREE.PointLight(0x8b5cf6, 1.5, 30)
    purpleLight.position.set(18, 4, -8)
    scene.add(purpleLight)

    // Cyan ground fill
    const cyanFill = new THREE.PointLight(0x06b6d4, 0.8, 40)
    cyanFill.position.set(0, 0.5, 8)
    scene.add(cyanFill)

    if (onSceneReady) onSceneReady(scene, camera, renderer)

    // ── Animation ──────────────────────────────────────────────────────
    const animate = () => {
      animIdRef.current = requestAnimationFrame(animate)
      const t = clockRef.current.getElapsedTime()

      // Subtle pulsing on accent lights
      blueLight.intensity   = 2.5 + Math.sin(t * 0.7) * 0.4
      purpleLight.intensity = 1.5 + Math.sin(t * 0.5 + 1) * 0.3
      cyanFill.intensity    = 0.8 + Math.sin(t * 1.1) * 0.2

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
