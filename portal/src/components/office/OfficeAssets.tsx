import { useEffect } from 'react'
import * as THREE from 'three'

interface OfficeAssetsProps {
  scene: THREE.Scene
}

export default function OfficeAssets({ scene }: OfficeAssetsProps) {
  useEffect(() => {
    // Desk positions
    const deskPositions = [
      { x: -12, z: 0 },
      { x: -6, z: -10 },
      { x: 0, z: -15 },
      { x: 6, z: -10 },
      { x: 12, z: 0 },
    ]

    deskPositions.forEach((pos, idx) => {
      createDetailedDesk(scene, pos.x, pos.z, idx)
    })

    return () => {
      // Cleanup handled by scene
    }
  }, [scene])

  return null
}

function createDetailedDesk(scene: THREE.Scene, x: number, z: number, index: number) {
  // Desk surface - wood texture style
  const deskSurface = new THREE.Mesh(
    new THREE.BoxGeometry(3.5, 0.05, 3.5),
    new THREE.MeshStandardMaterial({
      color: 0x5d4e37,
      roughness: 0.5,
      metalness: 0.1,
    })
  )
  deskSurface.position.set(x, 0.9, z)
  deskSurface.castShadow = true
  deskSurface.receiveShadow = true
  scene.add(deskSurface)

  // Desk frame - metal frame
  const frameMaterial = new THREE.MeshStandardMaterial({
    color: 0x2d2d2d,
    roughness: 0.3,
    metalness: 0.8,
  })

  // Front frame bar
  const frontBar = new THREE.Mesh(
    new THREE.BoxGeometry(3.5, 0.08, 0.08),
    frameMaterial
  )
  frontBar.position.set(x, 0.5, z + 1.6)
  frontBar.castShadow = true
  scene.add(frontBar)

  // Back frame bar
  const backBar = new THREE.Mesh(
    new THREE.BoxGeometry(3.5, 0.08, 0.08),
    frameMaterial
  )
  backBar.position.set(x, 0.5, z - 1.6)
  backBar.castShadow = true
  scene.add(backBar)

  // Left leg (vertical support)
  const leftLeg = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.95, 0.08),
    frameMaterial
  )
  leftLeg.position.set(x - 1.6, 0.475, z)
  leftLeg.castShadow = true
  scene.add(leftLeg)

  // Right leg (vertical support)
  const rightLeg = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.95, 0.08),
    frameMaterial
  )
  rightLeg.position.set(x + 1.6, 0.475, z)
  rightLeg.castShadow = true
  scene.add(rightLeg)

  // Monitor stand
  const monitorStand = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.3, 0.4),
    frameMaterial
  )
  monitorStand.position.set(x + 1.2, 0.95, z - 1.4)
  monitorStand.castShadow = true
  scene.add(monitorStand)

  // Monitor screen
  const monitorScreen = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 0.7, 0.05),
    new THREE.MeshStandardMaterial({
      color: 0x1a1a1a,
      roughness: 0.1,
      metalness: 0,
      emissive: 0x2a3f5f,
      emissiveIntensity: 0.3,
    })
  )
  monitorScreen.position.set(x + 1.2, 1.5, z - 1.4)
  monitorScreen.castShadow = true
  scene.add(monitorScreen)

  // Monitor bezel
  const monitorBezel = new THREE.Mesh(
    new THREE.BoxGeometry(1.3, 0.8, 0.08),
    new THREE.MeshStandardMaterial({
      color: 0x0d0d0d,
      roughness: 0.4,
      metalness: 0.3,
    })
  )
  monitorBezel.position.set(x + 1.2, 1.5, z - 1.4)
  scene.add(monitorBezel)

  // Keyboard
  const keyboard = new THREE.Mesh(
    new THREE.BoxGeometry(1.0, 0.05, 0.35),
    new THREE.MeshStandardMaterial({
      color: 0x2a2a2a,
      roughness: 0.6,
      metalness: 0.1,
    })
  )
  keyboard.position.set(x - 0.5, 0.92, z - 1.0)
  keyboard.castShadow = true
  scene.add(keyboard)

  // Mouse
  const mouse = new THREE.Mesh(
    new THREE.SphereGeometry(0.1, 8, 8),
    new THREE.MeshStandardMaterial({
      color: 0x333333,
      roughness: 0.5,
      metalness: 0.2,
    })
  )
  mouse.position.set(x - 1.2, 0.92, z - 1.0)
  mouse.scale.set(0.7, 0.5, 1.0)
  mouse.castShadow = true
  scene.add(mouse)

  // Desk drawer handle
  const drawerHandle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.08, 0.3),
    new THREE.MeshStandardMaterial({
      color: 0xb8a68f,
      roughness: 0.4,
      metalness: 0.5,
    })
  )
  drawerHandle.rotation.z = Math.PI / 2
  drawerHandle.position.set(x - 1.5, 0.5, z)
  scene.add(drawerHandle)

  // Desk lamp
  createDeskLamp(scene, x + 0.8, z - 1.5, 1.3)
}

function createDeskLamp(scene: THREE.Scene, x: number, z: number, height: number) {
  const lampMaterial = new THREE.MeshStandardMaterial({
    color: 0x2a2a2a,
    roughness: 0.3,
    metalness: 0.6,
  })

  // Lamp base
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.15, 0.15, 0.08),
    lampMaterial
  )
  base.position.set(x, height, z)
  base.castShadow = true
  scene.add(base)

  // Lamp pole
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.04, 0.6),
    lampMaterial
  )
  pole.position.set(x, height + 0.34, z)
  pole.castShadow = true
  scene.add(pole)

  // Lamp head
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 16, 16),
    lampMaterial
  )
  head.position.set(x, height + 0.7, z)
  head.castShadow = true
  scene.add(head)

  // Lamp light emitter
  const lampLight = new THREE.PointLight(0xffd700, 0.8, 8)
  lampLight.position.set(x, height + 0.7, z)
  scene.add(lampLight)
}
