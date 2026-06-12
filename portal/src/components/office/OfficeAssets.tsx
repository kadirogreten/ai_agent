import { useEffect } from 'react'
import * as THREE from 'three'
import { getAmphibDeskPositions } from '@/lib/office'

interface OfficeAssetsProps {
  scene: THREE.Scene
  deskCount?: number
}

export default function OfficeAssets({ scene, deskCount = 5 }: OfficeAssetsProps) {
  useEffect(() => {
    const deskPositions = getAmphibDeskPositions(Math.max(1, deskCount))
    const groups: THREE.Group[] = []

    deskPositions.forEach((pos) => {
      const g = new THREE.Group()
      g.position.set(pos.x, 0, pos.z)
      g.rotation.y = -Math.PI / 2 - pos.angle   // local +Z → center
      createDetailedDesk(g)
      scene.add(g)
      groups.push(g)
    })

    return () => {
      groups.forEach((g) => scene.remove(g))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, deskCount])

  return null
}

// All positions below are LOCAL (group origin = desk center on floor, y=0)
function createDetailedDesk(parent: THREE.Object3D) {
  const deskSurfaceMat = new THREE.MeshStandardMaterial({
    color: 0x8b7355,
    roughness: 0.5,
    metalness: 0.05,
  })
  const deskSurface = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.06, 3.8), deskSurfaceMat)
  deskSurface.position.set(0, 0.95, 0)
  deskSurface.castShadow = true
  deskSurface.receiveShadow = true
  deskSurface.userData.type = 'desk-surface'
  parent.add(deskSurface)

  const frameMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.2, metalness: 0.9 })

  const frontRail = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.12, 0.12), frameMat)
  frontRail.position.set(0, 0.45, 1.8)
  frontRail.castShadow = true
  parent.add(frontRail)

  const backRail = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.12, 0.12), frameMat)
  backRail.position.set(0, 0.45, -1.8)
  backRail.castShadow = true
  parent.add(backRail)

  createPedestal(parent, -1.7, 0.475, 0, frameMat)
  createPedestal(parent, 1.7, 0.475, 0, frameMat)

  // Monitor centered on desk, local z=-0.3 (back of desk, screen faces +z toward agent)
  createMonitorSetup(parent, 0, -0.3, frameMat)
  createKeyboardAndMouse(parent, -0.7, -1.2)
  createDetailedLamp(parent, 0.9, -1.6, 1.4)
  createPenHolder(parent, -1.4, -1.2)
  createBooksStack(parent, -1.8, 0.8)
  createCableManagement(parent, -1.5, 0.9, 0)
  createPlant(parent, 1.5, 1.2)
  createCoffeCup(parent, 1.8, 0.5)
  createNotebook(parent, -0.8, 1.0)
  createDeskOrganizer(parent, -1.2, 0.8)
}

function createPedestal(parent: THREE.Object3D, x: number, y: number, z: number, material: THREE.Material) {
  const column = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.0, 0.15), material)
  column.position.set(x, y, z)
  column.castShadow = true
  parent.add(column)

  const braceLower = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.1, 0.35), material)
  braceLower.position.set(x, 0.15, z)
  braceLower.castShadow = true
  parent.add(braceLower)

  const braceUpper = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.1, 0.35), material)
  braceUpper.position.set(x, 0.85, z)
  braceUpper.castShadow = true
  parent.add(braceUpper)
}

function createMonitorSetup(parent: THREE.Object3D, x: number, z: number, frameMat: THREE.Material) {
  const standBase = new THREE.Mesh(
    new THREE.BoxGeometry(0.65, 0.1, 0.55),
    new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.6, metalness: 0.2 })
  )
  standBase.position.set(x, 0.97, z)
  standBase.castShadow = true
  parent.add(standBase)

  const standColumn = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.35, 0.08), frameMat)
  standColumn.position.set(x, 1.28, z)
  standColumn.castShadow = true
  parent.add(standColumn)

  const bezel = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 0.95, 0.08),
    new THREE.MeshStandardMaterial({ color: 0x1f1f1f, roughness: 0.4, metalness: 0.4 })
  )
  bezel.position.set(x, 1.68, z)
  bezel.castShadow = true
  parent.add(bezel)

  const screen = new THREE.Mesh(
    new THREE.BoxGeometry(1.4, 0.85, 0.01),
    new THREE.MeshStandardMaterial({
      color: 0x121212,
      roughness: 0.08,
      metalness: 0.0,
      emissive: 0x2a4a6a,
      emissiveIntensity: 0.3,
    })
  )
  screen.position.set(x, 1.68, z + 0.045)
  parent.add(screen)

  const screenLight = new THREE.PointLight(0x4a7aba, 0.3, 3)
  screenLight.position.set(x, 1.68, z + 0.5)
  parent.add(screenLight)
}

function createKeyboardAndMouse(parent: THREE.Object3D, x: number, z: number) {
  const keyboardMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.7, metalness: 0.1 })

  const keyboard = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.04, 0.35), keyboardMat)
  keyboard.position.set(x, 0.96, z)
  keyboard.rotation.z = 0.05
  keyboard.castShadow = true
  parent.add(keyboard)

  const wristRest = new THREE.Mesh(
    new THREE.BoxGeometry(1.05, 0.03, 0.08),
    new THREE.MeshStandardMaterial({ color: 0x4a4a4a, roughness: 0.6 })
  )
  wristRest.position.set(x, 0.945, z + 0.25)
  wristRest.castShadow = true
  parent.add(wristRest)

  const mouseMat = new THREE.MeshStandardMaterial({ color: 0x353535, roughness: 0.5, metalness: 0.2 })
  const mouse = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 12), mouseMat)
  mouse.position.set(x + 0.6, 0.96, z - 0.15)
  mouse.scale.set(0.8, 0.6, 1.2)
  mouse.castShadow = true
  parent.add(mouse)

  const mouseCable = new THREE.Mesh(
    new THREE.CylinderGeometry(0.02, 0.02, 0.5),
    new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6 })
  )
  mouseCable.position.set(x + 0.6, 0.85, z)
  mouseCable.castShadow = true
  parent.add(mouseCable)
}

function createDetailedLamp(parent: THREE.Object3D, x: number, z: number, height: number) {
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x2d2d2d, roughness: 0.4, metalness: 0.7 })

  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 0.12), lampMat)
  base.position.set(x, height, z)
  base.castShadow = true
  parent.add(base)

  const armSegment1 = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.35), lampMat)
  armSegment1.position.set(x, height + 0.32, z)
  armSegment1.castShadow = true
  parent.add(armSegment1)

  const armSegment2 = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.4), lampMat)
  armSegment2.position.set(x + 0.15, height + 0.75, z - 0.1)
  armSegment2.rotation.z = 0.4
  armSegment2.castShadow = true
  parent.add(armSegment2)

  const shade = new THREE.Mesh(
    new THREE.SphereGeometry(0.14, 16, 16),
    new THREE.MeshStandardMaterial({ color: 0xffd700, roughness: 0.3, metalness: 0.1, emissive: 0xffa500, emissiveIntensity: 0.2 })
  )
  shade.position.set(x + 0.25, height + 1.1, z - 0.15)
  shade.castShadow = true
  parent.add(shade)

  const lampLight = new THREE.PointLight(0xffd700, 1.2, 10)
  lampLight.position.set(x + 0.25, height + 1.1, z - 0.15)
  parent.add(lampLight)
}

function createPenHolder(parent: THREE.Object3D, x: number, z: number) {
  const holder = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.12, 0.15),
    new THREE.MeshStandardMaterial({ color: 0x5a5a5a, roughness: 0.5, metalness: 0.2 })
  )
  holder.position.set(x, 1.02, z)
  holder.castShadow = true
  parent.add(holder)

  const penColors = [0xff6b6b, 0x4ecdc4, 0x45b7d1, 0xf7b731, 0x5f27cd]
  for (let i = 0; i < 5; i++) {
    const pen = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015, 0.015, 0.12),
      new THREE.MeshStandardMaterial({ color: penColors[i], roughness: 0.4, metalness: 0.3 })
    )
    const a = (i / 5) * Math.PI * 2
    pen.position.set(x + Math.cos(a) * 0.07, 1.1, z + Math.sin(a) * 0.07)
    pen.castShadow = true
    parent.add(pen)
  }
}

function createBooksStack(parent: THREE.Object3D, x: number, z: number) {
  const bookColors = [0x8b4513, 0xa0522d, 0x6b5344, 0x7f6946]
  bookColors.forEach((color, idx) => {
    const book = new THREE.Mesh(
      new THREE.BoxGeometry(0.25, 0.02 + idx * 0.005, 0.18),
      new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0 })
    )
    book.position.set(x, 1.02 + idx * 0.015, z)
    book.castShadow = true
    parent.add(book)
  })
}

function createCableManagement(parent: THREE.Object3D, x: number, y: number, z: number) {
  const tray = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 0.03, 0.15),
    new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6 })
  )
  tray.position.set(x, y - 0.02, z)
  tray.castShadow = true
  parent.add(tray)
}

function createPlant(parent: THREE.Object3D, x: number, z: number) {
  const pot = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.15, 0.15, 16),
    new THREE.MeshStandardMaterial({ color: 0xa0826d, roughness: 0.7, metalness: 0.0 })
  )
  pot.position.set(x, 1.02, z)
  pot.castShadow = true
  parent.add(pot)

  const leafMat = new THREE.MeshStandardMaterial({ color: 0x4a7c59, roughness: 0.6, metalness: 0.0 })
  const leafData: [number, number, number, number, number, number][] = [
    [-0.08, 1.25, -0.06, 1.2, 1.4, 0.7],
    [ 0.10, 1.30,  0.05, 1.3, 1.5, 0.7],
    [ 0.02, 1.35, -0.10, 1.1, 1.3, 0.6],
  ]
  leafData.forEach(([lx, ly, lz, sx, sy, sz]) => {
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), leafMat)
    leaf.position.set(x + lx, ly, z + lz)
    leaf.scale.set(sx, sy, sz)
    leaf.castShadow = true
    parent.add(leaf)
  })
}

function createCoffeCup(parent: THREE.Object3D, x: number, z: number) {
  const cupMat = new THREE.MeshStandardMaterial({ color: 0xf5e6d3, roughness: 0.4, metalness: 0.1 })

  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.09, 0.12, 12), cupMat)
  cup.position.set(x, 1.05, z)
  cup.castShadow = true
  parent.add(cup)

  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.015, 8, 8), cupMat)
  handle.position.set(x + 0.11, 1.08, z)
  handle.rotation.z = Math.PI / 2
  parent.add(handle)

  const coffee = new THREE.Mesh(
    new THREE.CylinderGeometry(0.075, 0.085, 0.08, 12),
    new THREE.MeshStandardMaterial({ color: 0x4a3728, roughness: 0.3, metalness: 0.0 })
  )
  coffee.position.set(x, 1.08, z)
  parent.add(coffee)
}

function createNotebook(parent: THREE.Object3D, x: number, z: number) {
  const notebook = new THREE.Mesh(
    new THREE.BoxGeometry(0.25, 0.01, 0.18),
    new THREE.MeshStandardMaterial({ color: 0x2d2416, roughness: 0.8, metalness: 0.0 })
  )
  notebook.position.set(x, 1.04, z)
  notebook.rotation.z = 0.2
  notebook.castShadow = true
  parent.add(notebook)

  const pages = new THREE.Mesh(
    new THREE.BoxGeometry(0.24, 0.009, 0.17),
    new THREE.MeshStandardMaterial({ color: 0xfaf8f3, roughness: 0.9, metalness: 0.0 })
  )
  pages.position.set(x, 1.042, z)
  pages.rotation.z = 0.2
  parent.add(pages)
}

function createDeskOrganizer(parent: THREE.Object3D, x: number, z: number) {
  const organizerMat = new THREE.MeshStandardMaterial({ color: 0x4a4a4a, roughness: 0.6, metalness: 0.1 })
  const organizer = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.04, 0.15), organizerMat)
  organizer.position.set(x, 1.03, z)
  organizer.castShadow = true
  parent.add(organizer)

  const dividerMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.5, metalness: 0.2 })
  for (let i = 0; i < 3; i++) {
    const divider = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.04, 0.12), dividerMat)
    divider.position.set(x - 0.1 + i * 0.15, 1.035, z)
    parent.add(divider)
  }
}
