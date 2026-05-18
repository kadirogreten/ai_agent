import { useEffect, useRef } from 'react'
import * as THREE from 'three'

interface Office3DSceneProps {
  onSceneReady?: (scene: THREE.Scene, camera: THREE.Camera, renderer: THREE.WebGLRenderer) => void
  children?: React.ReactNode
}

export default function Office3DScene({ onSceneReady, children }: Office3DSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const animationIdRef = useRef<number | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const width = containerRef.current.clientWidth
    const height = containerRef.current.clientHeight
    console.log('Canvas size:', { width, height })

    // Scene setup
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0xc5d3e0) // Light gray-blue office wall color
    sceneRef.current = scene

    // Camera setup - positioned as if standing in office looking across space
    const camera = new THREE.PerspectiveCamera(70, width / height, 0.1, 1000)
    camera.position.set(15, 7, 25)
    camera.lookAt(0, 2, 0)
    cameraRef.current = camera
    console.log('Camera positioned:', camera.position)

    // Renderer setup
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    renderer.setSize(width, height)
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    containerRef.current.appendChild(renderer.domElement)
    rendererRef.current = renderer

    // Realistic office lighting
    // Ambient light - simulates overall office illumination
    const ambientLight = new THREE.AmbientLight(0xd4d4d4, 0.6)
    scene.add(ambientLight)

    // Main overhead directional light - simulates ceiling lights
    const directionalLight = new THREE.DirectionalLight(0xf5f5dc, 1.1)
    directionalLight.position.set(10, 22, 5)
    directionalLight.castShadow = true
    directionalLight.shadow.mapSize.width = 2048
    directionalLight.shadow.mapSize.height = 2048
    directionalLight.shadow.camera.far = 50
    directionalLight.shadow.camera.left = -30
    directionalLight.shadow.camera.right = 30
    directionalLight.shadow.camera.top = 30
    directionalLight.shadow.camera.bottom = -30
    scene.add(directionalLight)

    // Subtle fill light from window - natural light effect
    const fillLight = new THREE.PointLight(0xe8eef5, 0.4, 50)
    fillLight.position.set(-25, 12, 0)
    scene.add(fillLight)

    // Light from the side to create depth
    const sideLight = new THREE.PointLight(0xd4d4d4, 0.3, 40)
    sideLight.position.set(25, 10, 0)
    scene.add(sideLight)

    // Notify parent that scene is ready
    if (onSceneReady) {
      onSceneReady(scene, camera, renderer)
    }

    // Animation loop
    const animate = () => {
      animationIdRef.current = requestAnimationFrame(animate)
      renderer.render(scene, camera)
    }
    animate()

    // Handle window resize
    const handleResize = () => {
      const newWidth = containerRef.current?.clientWidth ?? width
      const newHeight = containerRef.current?.clientHeight ?? height

      camera.aspect = newWidth / newHeight
      camera.updateProjectionMatrix()
      renderer.setSize(newWidth, newHeight)
    }

    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      if (animationIdRef.current !== null) {
        cancelAnimationFrame(animationIdRef.current)
      }
      renderer.dispose()
      containerRef.current?.removeChild(renderer.domElement)
    }
  }, [])

  return (
    <div ref={containerRef} className="w-full h-full">
      {children}
    </div>
  )
}
