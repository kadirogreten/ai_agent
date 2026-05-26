import { useEffect } from 'react'
import * as THREE from 'three'

interface OfficeAssetsProps {
  scene: THREE.Scene
}

export default function OfficeAssets({ scene }: OfficeAssetsProps) {
  useEffect(() => {
    console.log('OfficeAssets: Creating detailed desk furniture...')

    const deskPositions = [
      { x: -12, z: 0 },
      { x: -6, z: -10 },
      { x: 0, z: -15 },
      { x: 6, z: -10 },
      { x: 12, z: 0 },
    ]

    deskPositions.forEach((pos) => {
      createDetailedDesk(scene, pos.x, pos.z)
    })

    console.log('OfficeAssets: Desk furniture created')

    return () => {
      // Cleanup handled by scene
    }
  }, [scene])

  return null
}

function createDetailedDesk(scene: THREE.Scene, x: number, z: number) {
  // Main desk surface - realistic wood with better material properties
  const deskSurfaceGeom = new THREE.BoxGeometry(3.8, 0.06, 3.8)
  const deskSurfaceMat = new THREE.MeshStandardMaterial({
    color: 0x8b7355, // Warmer wood tone
    roughness: 0.5, // Less rough for a polished wood look
    metalness: 0.05, // Slight metallic sheen
  })
  const deskSurface = new THREE.Mesh(deskSurfaceGeom, deskSurfaceMat)
  deskSurface.position.set(x, 0.95, z)
  deskSurface.castShadow = true
  deskSurface.receiveShadow = true
  deskSurface.userData.type = 'desk-surface'
  scene.add(deskSurface)

  // Desk frame - metal/steel look
  const frameMat = new THREE.MeshStandardMaterial({
    color: 0x3a3a3a,
    roughness: 0.2,
    metalness: 0.9,
  })

  // Front support rail
  const frontRail = new THREE.Mesh(
    new THREE.BoxGeometry(3.8, 0.12, 0.12),
    frameMat
  )
  frontRail.position.set(x, 0.45, z + 1.8)
  frontRail.castShadow = true
  scene.add(frontRail)

  // Back support rail
  const backRail = new THREE.Mesh(
    new THREE.BoxGeometry(3.8, 0.12, 0.12),
    frameMat
  )
  backRail.position.set(x, 0.45, z - 1.8)
  backRail.castShadow = true
  scene.add(backRail)

  // Left pedestal
  createPedestal(scene, x - 1.7, 0.475, z, frameMat)

  // Right pedestal
  createPedestal(scene, x + 1.7, 0.475, z, frameMat)

  // Monitor setup - left side
  createMonitorSetup(scene, x + 1.3, z - 1.5, frameMat)

  // Keyboard and mouse
  createKeyboardAndMouse(scene, x - 0.7, z - 1.2)

  // Desk lamp
  createDetailedLamp(scene, x + 0.9, z - 1.6, 1.4)

  // Pen holder with pens
  createPenHolder(scene, x - 1.4, z - 1.2)

  // Books/papers stack
  createBooksStack(scene, x - 1.8, z + 0.8)

  // Cable management
  createCableManagement(scene, x - 1.5, 0.9, z)

  // Desk plant - small potted plant
  createPlant(scene, x + 1.5, z + 1.2)

  // Coffee cup/mug
  createCoffeCup(scene, x + 1.8, z + 0.5)

  // Notebook/notepad
  createNotebook(scene, x - 0.8, z + 1.0)

  // Desk organizer/tray
  createDeskOrganizer(scene, x - 1.2, z + 0.8)
}

function createPedestal(
  scene: THREE.Scene,
  x: number,
  y: number,
  z: number,
  material: THREE.Material
) {
  // Vertical support column
  const column = new THREE.Mesh(
    new THREE.BoxGeometry(0.15, 1.0, 0.15),
    material
  )
  column.position.set(x, y, z)
  column.castShadow = true
  scene.add(column)

  // Horizontal brace lower
  const braceLower = new THREE.Mesh(
    new THREE.BoxGeometry(0.35, 0.1, 0.35),
    material
  )
  braceLower.position.set(x, 0.15, z)
  braceLower.castShadow = true
  scene.add(braceLower)

  // Horizontal brace upper
  const braceUpper = new THREE.Mesh(
    new THREE.BoxGeometry(0.35, 0.1, 0.35),
    material
  )
  braceUpper.position.set(x, 0.85, z)
  braceUpper.castShadow = true
  scene.add(braceUpper)
}

function createMonitorSetup(
  scene: THREE.Scene,
  x: number,
  z: number,
  frameMat: THREE.Material
) {
  // Monitor stand base - more stable, realistic proportions
  const standBase = new THREE.Mesh(
    new THREE.BoxGeometry(0.65, 0.1, 0.55),
    new THREE.MeshStandardMaterial({
      color: 0x2a2a2a,
      roughness: 0.6,
      metalness: 0.2,
    })
  )
  standBase.position.set(x, 0.97, z)
  standBase.castShadow = true
  scene.add(standBase)

  // Stand column - vertical support
  const standColumn = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.35, 0.08),
    frameMat
  )
  standColumn.position.set(x, 1.28, z)
  standColumn.castShadow = true
  scene.add(standColumn)

  // Monitor bezel - modern thin frame with slight depth
  const bezelMat = new THREE.MeshStandardMaterial({
    color: 0x1f1f1f,
    roughness: 0.4,
    metalness: 0.4,
  })
  const bezel = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 0.95, 0.08),
    bezelMat
  )
  bezel.position.set(x, 1.68, z)
  bezel.castShadow = true
  scene.add(bezel)

  // Monitor screen - modern display with subtle glow
  const screenMat = new THREE.MeshStandardMaterial({
    color: 0x121212, // Darker for more realistic screen
    roughness: 0.08,
    metalness: 0.0,
    emissive: 0x2a4a6a, // Subtle blue glow
    emissiveIntensity: 0.3,
  })
  const screen = new THREE.Mesh(
    new THREE.BoxGeometry(1.4, 0.85, 0.01),
    screenMat
  )
  screen.position.set(x, 1.68, z + 0.045)
  screen.castShadow = true
  scene.add(screen)

  // Subtle screen reflection light - very dim
  const screenLight = new THREE.PointLight(0x4a7aba, 0.3, 3)
  screenLight.position.set(x, 1.68, z + 0.5)
  scene.add(screenLight)
}

function createKeyboardAndMouse(
  scene: THREE.Scene,
  x: number,
  z: number
) {
  const keyboardMat = new THREE.MeshStandardMaterial({
    color: 0x2a2a2a,
    roughness: 0.7,
    metalness: 0.1,
  })

  // Keyboard - realistic proportions
  const keyboard = new THREE.Mesh(
    new THREE.BoxGeometry(1.1, 0.04, 0.35),
    keyboardMat
  )
  keyboard.position.set(x, 0.96, z)
  keyboard.rotation.z = 0.05 // slight tilt
  keyboard.castShadow = true
  scene.add(keyboard)

  // Keyboard wrist rest
  const wristRest = new THREE.Mesh(
    new THREE.BoxGeometry(1.05, 0.03, 0.08),
    new THREE.MeshStandardMaterial({
      color: 0x4a4a4a,
      roughness: 0.6,
    })
  )
  wristRest.position.set(x, 0.945, z + 0.25)
  wristRest.castShadow = true
  scene.add(wristRest)

  // Mouse - ergonomic shape
  const mouseMat = new THREE.MeshStandardMaterial({
    color: 0x353535,
    roughness: 0.5,
    metalness: 0.2,
  })
  const mouse = new THREE.Mesh(
    new THREE.SphereGeometry(0.08, 12, 12),
    mouseMat
  )
  mouse.position.set(x + 0.6, 0.96, z - 0.15)
  mouse.scale.set(0.8, 0.6, 1.2)
  mouse.castShadow = true
  scene.add(mouse)

  // Mouse cable
  const cableMat = new THREE.MeshStandardMaterial({
    color: 0x1a1a1a,
    roughness: 0.6,
  })
  const mouseCable = new THREE.Mesh(
    new THREE.CylinderGeometry(0.02, 0.02, 0.5),
    cableMat
  )
  mouseCable.position.set(x + 0.6, 0.85, z)
  mouseCable.castShadow = true
  scene.add(mouseCable)
}

function createDetailedLamp(
  scene: THREE.Scene,
  x: number,
  z: number,
  height: number
) {
  const lampMat = new THREE.MeshStandardMaterial({
    color: 0x2d2d2d,
    roughness: 0.4,
    metalness: 0.7,
  })

  // Heavy base
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.2, 0.12),
    lampMat
  )
  base.position.set(x, height, z)
  base.castShadow = true
  scene.add(base)

  // Flexible arm - curved
  const armSegment1 = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, 0.35),
    lampMat
  )
  armSegment1.position.set(x, height + 0.32, z)
  armSegment1.castShadow = true
  scene.add(armSegment1)

  const armSegment2 = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, 0.4),
    lampMat
  )
  armSegment2.position.set(x + 0.15, height + 0.75, z - 0.1)
  armSegment2.rotation.z = 0.4
  armSegment2.castShadow = true
  scene.add(armSegment2)

  // Lamp head - shade
  const shadeMat = new THREE.MeshStandardMaterial({
    color: 0xffd700,
    roughness: 0.3,
    metalness: 0.1,
    emissive: 0xffa500,
    emissiveIntensity: 0.2,
  })
  const shade = new THREE.Mesh(
    new THREE.SphereGeometry(0.14, 16, 16),
    shadeMat
  )
  shade.position.set(x + 0.25, height + 1.1, z - 0.15)
  shade.castShadow = true
  scene.add(shade)

  // Lamp light
  const lampLight = new THREE.PointLight(0xffd700, 1.2, 10)
  lampLight.position.set(x + 0.25, height + 1.1, z - 0.15)
  scene.add(lampLight)
}

function createPenHolder(
  scene: THREE.Scene,
  x: number,
  z: number
) {
  const holderMat = new THREE.MeshStandardMaterial({
    color: 0x5a5a5a,
    roughness: 0.5,
    metalness: 0.2,
  })

  // Pen holder cup
  const holder = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.12, 0.15),
    holderMat
  )
  holder.position.set(x, 1.02, z)
  holder.castShadow = true
  scene.add(holder)

  // Pens
  for (let i = 0; i < 5; i++) {
    const penColors = [0xff6b6b, 0x4ecdc4, 0x45b7d1, 0xf7b731, 0x5f27cd]
    const penMat = new THREE.MeshStandardMaterial({
      color: penColors[i],
      roughness: 0.4,
      metalness: 0.3,
    })
    const pen = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015, 0.015, 0.12),
      penMat
    )
    const angle = (i / 5) * Math.PI * 2
    pen.position.set(
      x + Math.cos(angle) * 0.07,
      1.1,
      z + Math.sin(angle) * 0.07
    )
    pen.castShadow = true
    scene.add(pen)
  }
}

function createBooksStack(
  scene: THREE.Scene,
  x: number,
  z: number
) {
  const bookColors = [0x8b4513, 0xa0522d, 0x6b5344, 0x7f6946]

  bookColors.forEach((color, idx) => {
    const bookMat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.7,
      metalness: 0,
    })
    const book = new THREE.Mesh(
      new THREE.BoxGeometry(0.25, 0.02 + idx * 0.005, 0.18),
      bookMat
    )
    book.position.set(x, 1.02 + idx * 0.015, z)
    book.castShadow = true
    scene.add(book)
  })
}

function createCableManagement(
  scene: THREE.Scene,
  x: number,
  y: number,
  z: number
) {
  const cableMat = new THREE.MeshStandardMaterial({
    color: 0x1a1a1a,
    roughness: 0.6,
  })

  // Cable tray under desk
  const tray = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 0.03, 0.15),
    cableMat
  )
  tray.position.set(x, y - 0.02, z)
  tray.castShadow = true
  scene.add(tray)
}

function createPlant(scene: THREE.Scene, x: number, z: number) {
  // Plant pot
  const potMat = new THREE.MeshStandardMaterial({
    color: 0xa0826d,
    roughness: 0.7,
    metalness: 0.0,
  })
  const pot = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.15, 0.15, 16),
    potMat
  )
  pot.position.set(x, 1.02, z)
  pot.castShadow = true
  scene.add(pot)

  // Plant leaves - simple green spheres
  const leafMat = new THREE.MeshStandardMaterial({
    color: 0x4a7c59,
    roughness: 0.6,
    metalness: 0.0,
  })

  const leaf1 = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), leafMat)
  leaf1.position.set(x - 0.08, 1.25, z - 0.06)
  leaf1.scale.set(1.2, 1.4, 0.7)
  leaf1.castShadow = true
  scene.add(leaf1)

  const leaf2 = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), leafMat)
  leaf2.position.set(x + 0.1, 1.3, z + 0.05)
  leaf2.scale.set(1.3, 1.5, 0.7)
  leaf2.castShadow = true
  scene.add(leaf2)

  const leaf3 = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), leafMat)
  leaf3.position.set(x + 0.02, 1.35, z - 0.1)
  leaf3.scale.set(1.1, 1.3, 0.6)
  leaf3.castShadow = true
  scene.add(leaf3)
}

function createCoffeCup(scene: THREE.Scene, x: number, z: number) {
  // Cup body
  const cupMat = new THREE.MeshStandardMaterial({
    color: 0xf5e6d3,
    roughness: 0.4,
    metalness: 0.1,
  })
  const cup = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.09, 0.12, 12),
    cupMat
  )
  cup.position.set(x, 1.05, z)
  cup.castShadow = true
  scene.add(cup)

  // Cup handle
  const handle = new THREE.Mesh(
    new THREE.TorusGeometry(0.06, 0.015, 8, 8),
    cupMat
  )
  handle.position.set(x + 0.11, 1.08, z)
  handle.rotation.z = Math.PI / 2
  scene.add(handle)

  // Coffee inside
  const coffeeMat = new THREE.MeshStandardMaterial({
    color: 0x4a3728,
    roughness: 0.3,
    metalness: 0.0,
  })
  const coffee = new THREE.Mesh(
    new THREE.CylinderGeometry(0.075, 0.085, 0.08, 12),
    coffeeMat
  )
  coffee.position.set(x, 1.08, z)
  scene.add(coffee)
}

function createNotebook(
  scene: THREE.Scene,
  x: number,
  z: number
) {
  // Notebook cover - leather-like
  const notebookMat = new THREE.MeshStandardMaterial({
    color: 0x2d2416,
    roughness: 0.8,
    metalness: 0.0,
  })
  const notebook = new THREE.Mesh(
    new THREE.BoxGeometry(0.25, 0.01, 0.18),
    notebookMat
  )
  notebook.position.set(x, 1.04, z)
  notebook.rotation.z = 0.2 // Slight angle
  notebook.castShadow = true
  scene.add(notebook)

  // Pages inside
  const pagesMat = new THREE.MeshStandardMaterial({
    color: 0xfaf8f3,
    roughness: 0.9,
    metalness: 0.0,
  })
  const pages = new THREE.Mesh(
    new THREE.BoxGeometry(0.24, 0.009, 0.17),
    pagesMat
  )
  pages.position.set(x, 1.042, z)
  pages.rotation.z = 0.2
  scene.add(pages)
}

function createDeskOrganizer(
  scene: THREE.Scene,
  x: number,
  z: number
) {
  // Organizer tray - simple box
  const organizerMat = new THREE.MeshStandardMaterial({
    color: 0x4a4a4a,
    roughness: 0.6,
    metalness: 0.1,
  })
  const organizer = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.04, 0.15),
    organizerMat
  )
  organizer.position.set(x, 1.03, z)
  organizer.castShadow = true
  scene.add(organizer)

  // Dividers inside
  const dividerMat = new THREE.MeshStandardMaterial({
    color: 0x3a3a3a,
    roughness: 0.5,
    metalness: 0.2,
  })

  for (let i = 0; i < 3; i++) {
    const divider = new THREE.Mesh(
      new THREE.BoxGeometry(0.02, 0.04, 0.12),
      dividerMat
    )
    divider.position.set(x - 0.1 + i * 0.15, 1.035, z)
    scene.add(divider)
  }
}
