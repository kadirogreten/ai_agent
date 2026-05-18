import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useOfficeCamera } from '@/hooks/useOfficeCamera'

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

    // Realistic office lighting system
    // Ambient light - overall office illumination
    const ambientLight = new THREE.AmbientLight(0xd0d8e0, 0.7)
    scene.add(ambientLight)

    // Main overhead directional light - primary ceiling light
    const directionalLight = new THREE.DirectionalLight(0xf8f6f0, 1.2)
    directionalLight.position.set(8, 24, 8)
    directionalLight.castShadow = true
    directionalLight.shadow.mapSize.width = 2048
    directionalLight.shadow.mapSize.height = 2048
    directionalLight.shadow.camera.far = 60
    directionalLight.shadow.camera.left = -35
    directionalLight.shadow.camera.right = 35
    directionalLight.shadow.camera.top = 35
    directionalLight.shadow.camera.bottom = -35
    scene.add(directionalLight)

    // Grid of ceiling lights across the office
    const ceilingHeight = 20
    const gridSize = 10
    const lightIntensity = 0.6

    for (let i = -15; i <= 15; i += gridSize) {
      for (let j = -15; j <= 15; j += gridSize) {
        const ceilingLight = new THREE.PointLight(0xf5f5f0, lightIntensity, 25)
        ceilingLight.position.set(i, ceilingHeight, j)
        ceilingLight.castShadow = false
        scene.add(ceilingLight)
      }
    }

    // Warm task lighting at desk areas
    const deskPositions = [
      { x: -12, z: 0 },
      { x: -6, z: -10 },
      { x: 0, z: -15 },
      { x: 6, z: -10 },
      { x: 12, z: 0 },
    ]

    deskPositions.forEach((pos) => {
      const taskLight = new THREE.PointLight(0xf5e6d3, 0.8, 12) // Warm light
      taskLight.position.set(pos.x, 2.5, pos.z)
      scene.add(taskLight)
    })

    // Window light effect - soft natural light from left
    const windowLight = new THREE.PointLight(0xe8eef8, 0.5, 60)
    windowLight.position.set(-28, 10, 0)
    scene.add(windowLight)

    // Fill light from opposite side for balanced lighting
    const fillLight = new THREE.PointLight(0xd4d8e0, 0.3, 50)
    fillLight.position.set(25, 8, 0)
    scene.add(fillLight)

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

  // Setup camera controls
  useOfficeCamera({
    camera: cameraRef.current,
    renderer: containerRef.current,
  })

  return (
    <div ref={containerRef} className="w-full h-full">
      {children}
    </div>
  )
}
