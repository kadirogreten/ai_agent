import { useEffect } from 'react'
import * as THREE from 'three'

interface OfficeGeometryProps {
  scene: THREE.Scene
}

export default function OfficeGeometry({ scene }: OfficeGeometryProps) {
  useEffect(() => {
    console.log('OfficeGeometry: Creating floor and geometry...')

    // Floor - light polished concrete/tile for modern office
    const floorGeometry = new THREE.PlaneGeometry(40, 40, 20, 20)
    const floorMaterial = new THREE.MeshStandardMaterial({
      color: 0x9ca3af, // Light gray office floor
      roughness: 0.5,
      metalness: 0.0,
      wireframe: false,
    })
    const floor = new THREE.Mesh(floorGeometry, floorMaterial)
    floor.rotation.x = -Math.PI / 2
    floor.receiveShadow = true
    floor.userData.type = 'floor'
    scene.add(floor)
    console.log('OfficeGeometry: Floor added to scene')

    // Floor grid lines for subtle tile pattern
    const gridHelper = new THREE.GridHelper(40, 10, 0xb0b8c1, 0xa0a8b1)
    gridHelper.position.y = 0.02
    scene.add(gridHelper)

    // Add subtle floor tile variation
    for (let i = -20; i < 20; i += 4) {
      for (let j = -20; j < 20; j += 4) {
        const tileGeometry = new THREE.PlaneGeometry(3.8, 3.8)
        const tileMaterial = new THREE.MeshStandardMaterial({
          color: (i + j) % 8 === 0 ? 0x8f97a3 : 0x9ca3af,
          roughness: 0.5,
          metalness: 0.0,
        })
        const tile = new THREE.Mesh(tileGeometry, tileMaterial)
        tile.rotation.x = -Math.PI / 2
        tile.position.set(i + 2, 0.01, j + 2)
        scene.add(tile)
      }
    }

    // Walls - light drywall for modern office
    const wallMaterial = new THREE.MeshStandardMaterial({
      color: 0xd1d8e0, // Light gray office wall
      roughness: 0.8,
      metalness: 0.0,
    })

    // North wall - with windows
    const northWall = new THREE.Mesh(
      new THREE.BoxGeometry(40, 4, 0.2),
      wallMaterial
    )
    northWall.position.set(0, 2, -20)
    northWall.castShadow = true
    northWall.receiveShadow = true
    scene.add(northWall)

    // North wall windows
    addWindowsToWall(scene, 0, 2.5, -20, true, 8)

    // South wall - with glass doors
    const southWall = new THREE.Mesh(
      new THREE.BoxGeometry(40, 4, 0.2),
      wallMaterial
    )
    southWall.position.set(0, 2, 20)
    southWall.castShadow = true
    southWall.receiveShadow = true
    scene.add(southWall)

    // South wall - office exit doors
    addDoorsToWall(scene, 0, 2, 20, true, 4)

    // East wall - with accent lighting
    const eastWall = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 4, 40),
      wallMaterial
    )
    eastWall.position.set(20, 2, 0)
    eastWall.castShadow = true
    eastWall.receiveShadow = true
    scene.add(eastWall)

    // Add accent light on east wall
    const eastLight = new THREE.PointLight(0x4a7ba7, 0.4, 30)
    eastLight.position.set(19, 2, 0)
    scene.add(eastLight)

    // West wall - with shelving
    const westWall = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 4, 40),
      wallMaterial
    )
    westWall.position.set(-20, 2, 0)
    westWall.castShadow = true
    westWall.receiveShadow = true
    scene.add(westWall)

    // West wall shelving
    addShelvingToWall(scene, -20, 40)

    // Wall trim/baseboard - light trim for modern office
    const baseboardMaterial = new THREE.MeshStandardMaterial({
      color: 0xb8c0ca, // Light gray trim
      roughness: 0.7,
      metalness: 0.0,
    })

    // Front baseboard
    const frontBaseboard = new THREE.Mesh(
      new THREE.BoxGeometry(40, 0.3, 0.2),
      baseboardMaterial
    )
    frontBaseboard.position.set(0, 0.2, -20)
    frontBaseboard.castShadow = true
    scene.add(frontBaseboard)

    // Back baseboard
    const backBaseboard = new THREE.Mesh(
      new THREE.BoxGeometry(40, 0.3, 0.2),
      baseboardMaterial
    )
    backBaseboard.position.set(0, 0.2, 20)
    backBaseboard.castShadow = true
    scene.add(backBaseboard)

    // Right baseboard
    const rightBaseboard = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.3, 40),
      baseboardMaterial
    )
    rightBaseboard.position.set(20, 0.2, 0)
    rightBaseboard.castShadow = true
    scene.add(rightBaseboard)

    // Left baseboard
    const leftBaseboard = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.3, 40),
      baseboardMaterial
    )
    leftBaseboard.position.set(-20, 0.2, 0)
    leftBaseboard.castShadow = true
    scene.add(leftBaseboard)

    // Desk positions (agent work areas) - 5 desks in a semi-circle
    const deskPositions = [
      { x: -12, z: 0, label: 'Desk 1' },
      { x: -6, z: -10, label: 'Desk 2' },
      { x: 0, z: -15, label: 'Desk 3' },
      { x: 6, z: -10, label: 'Desk 4' },
      { x: 12, z: 0, label: 'Desk 5' },
    ]

    const deskMaterial = new THREE.MeshStandardMaterial({
      color: 0x2d3f5b,
      roughness: 0.6,
      metalness: 0.3,
    })

    deskPositions.forEach((pos, idx) => {
      // Desk surface - larger and more visible
      const desk = new THREE.Mesh(
        new THREE.BoxGeometry(3.5, 0.9, 3.5),
        deskMaterial
      )
      desk.position.set(pos.x, 0.45, pos.z)
      desk.castShadow = true
      desk.receiveShadow = true
      desk.userData.deskIndex = idx
      desk.userData.label = pos.label
      scene.add(desk)

      // Desk legs
      const legGeometry = new THREE.CylinderGeometry(0.15, 0.15, 0.8)
      const legMaterial = new THREE.MeshStandardMaterial({
        color: 0x0f1829,
        roughness: 0.8,
      })

      const legPositions = [
        { x: -1, z: -1 },
        { x: 1, z: -1 },
        { x: -1, z: 1 },
        { x: 1, z: 1 },
      ]

      legPositions.forEach((lp) => {
        const leg = new THREE.Mesh(legGeometry, legMaterial)
        leg.position.set(pos.x + lp.x, 0.4, pos.z + lp.z)
        leg.castShadow = true
        leg.receiveShadow = true
        scene.add(leg)
      })

      // Neon accent light above desk
      const neonLight = new THREE.PointLight(0x3b82f6, 1, 15)
      neonLight.position.set(pos.x, 2, pos.z)
      scene.add(neonLight)
    })

    // CEO Meeting Zone (center area) - meeting area with subtle accent
    const ceoZone = new THREE.Mesh(
      new THREE.CylinderGeometry(7, 7, 0.15, 32),
      new THREE.MeshStandardMaterial({
        color: 0x7dd3fc, // Light blue accent
        emissive: 0x38bdf8, // Subtle sky blue glow
        emissiveIntensity: 0.4,
        roughness: 0.4,
        metalness: 0.2,
      })
    )
    ceoZone.position.set(0, 0.08, 5)
    ceoZone.receiveShadow = true
    ceoZone.castShadow = true
    ceoZone.userData.type = 'ceoZone'
    scene.add(ceoZone)

    // Ring around CEO zone for better visibility
    const ringGeometry = new THREE.TorusGeometry(7.2, 0.3, 16, 100)
    const ringMaterial = new THREE.MeshStandardMaterial({
      color: 0x38bdf8, // Sky blue ring
      emissive: 0x0ea5e9,
      emissiveIntensity: 0.6,
    })
    const ring = new THREE.Mesh(ringGeometry, ringMaterial)
    ring.position.set(0, 0.5, 5)
    ring.rotation.x = Math.PI / 2
    scene.add(ring)

    // Subtle glow for CEO zone - not too bright
    const ceoGlow = new THREE.PointLight(0x0ea5e9, 1.5, 20)
    ceoGlow.position.set(0, 3.5, 5)
    scene.add(ceoGlow)

    // Task Pipeline Display Area (right side)
    const pipelineBase = new THREE.Mesh(
      new THREE.BoxGeometry(12, 0.2, 8),
      new THREE.MeshStandardMaterial({
        color: 0x1e293b,
        roughness: 0.6,
      })
    )
    pipelineBase.position.set(14, 0.1, -2)
    pipelineBase.userData.type = 'pipelineArea'
    scene.add(pipelineBase)

    // Pipeline stage markers
    const stageLabels = ['Pending', 'Running', 'Success', 'Failed']
    stageLabels.forEach((label, idx) => {
      const stageLight = new THREE.PointLight(0xec4899, 1.5, 10)
      stageLight.position.set(8 + idx * 3, 2, -2)
      scene.add(stageLight)
    })

    // Data flow visualization helper - connect desks with lines
    const lineMaterial = new THREE.LineBasicMaterial({
      color: 0x3b82f6,
      linewidth: 2,
      fog: false,
    })

    const lineGeometry = new THREE.BufferGeometry()
    const points: THREE.Vector3[] = []

    // Create a path connecting all desks
    deskPositions.forEach((pos) => {
      points.push(new THREE.Vector3(pos.x, 1.5, pos.z))
    })

    // Close the loop back to first desk
    if (points.length > 0) {
      points.push(points[0].clone())
    }

    lineGeometry.setFromPoints(points)
    const flowLine = new THREE.Line(lineGeometry, lineMaterial)
    flowLine.userData.type = 'flowPath'
    scene.add(flowLine)

    return () => {
      // Cleanup
      floorGeometry.dispose()
      floorMaterial.dispose()
      wallMaterial.dispose()
      deskMaterial.dispose()
      lineMaterial.dispose()
      lineGeometry.dispose()
    }
  }, [scene])

  return null
}

function addWindowsToWall(
  scene: THREE.Scene,
  x: number,
  y: number,
  z: number,
  isHorizontal: boolean,
  count: number
) {
  const windowSpacing = 40 / (count + 1)
  for (let i = 1; i <= count; i++) {
    const windowX = isHorizontal ? -20 + i * windowSpacing : x
    const windowZ = isHorizontal ? z : -20 + i * windowSpacing

    // Window frame
    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x1a1a1a,
      roughness: 0.3,
      metalness: 0.5,
    })
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 1.2, 0.15),
      frameMat
    )
    frame.position.set(windowX, y, z)
    frame.castShadow = true
    scene.add(frame)

    // Glass pane - with sky reflection
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x4a7ba7,
      roughness: 0.1,
      metalness: 0.3,
      transparent: true,
      opacity: 0.6,
    })
    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(1.0, 1.0, 0.02),
      glassMat
    )
    glass.position.set(windowX, y, z + 0.08)
    scene.add(glass)

    // Window light
    const windowLight = new THREE.PointLight(0xffffff, 0.5, 8)
    windowLight.position.set(windowX, y, z + 1)
    scene.add(windowLight)
  }
}

function addDoorsToWall(
  scene: THREE.Scene,
  x: number,
  y: number,
  z: number,
  isHorizontal: boolean,
  count: number
) {
  const doorSpacing = 40 / (count + 1)
  for (let i = 1; i <= count; i++) {
    const doorX = isHorizontal ? -20 + i * doorSpacing : x
    const doorZ = isHorizontal ? z : -20 + i * doorSpacing

    // Door frame
    const doorFrameMat = new THREE.MeshStandardMaterial({
      color: 0x1a1a1a,
      roughness: 0.4,
      metalness: 0.6,
    })
    const doorFrame = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 2.4, 0.1),
      doorFrameMat
    )
    doorFrame.position.set(doorX, 1.2, z)
    doorFrame.castShadow = true
    scene.add(doorFrame)

    // Glass door
    const doorMat = new THREE.MeshStandardMaterial({
      color: 0x3d5a7a,
      roughness: 0.2,
      metalness: 0.2,
      transparent: true,
      opacity: 0.5,
    })
    const door = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 2.3, 0.02),
      doorMat
    )
    door.position.set(doorX, 1.2, z + 0.06)
    scene.add(door)

    // Door handle
    const handleMat = new THREE.MeshStandardMaterial({
      color: 0xc0a080,
      roughness: 0.3,
      metalness: 0.7,
    })
    const handle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, 0.1),
      handleMat
    )
    handle.rotation.z = Math.PI / 2
    handle.position.set(doorX + 0.35, 1.2, z + 0.1)
    scene.add(handle)
  }
}

function addShelvingToWall(scene: THREE.Scene, x: number, wallLength: number) {
  const shelfCount = 4
  const shelfSpacing = 0.9
  const shelfMat = new THREE.MeshStandardMaterial({
    color: 0x5a4a3a,
    roughness: 0.6,
    metalness: 0.1,
  })

  for (let shelf = 0; shelf < shelfCount; shelf++) {
    const shelfY = 1.0 + shelf * shelfSpacing

    // Shelf
    const shelf3D = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.04, wallLength - 4),
      shelfMat
    )
    shelf3D.position.set(x - 0.15, shelfY, 0)
    shelf3D.castShadow = true
    scene.add(shelf3D)

    // Books on shelf
    for (let i = 0; i < 5; i++) {
      const bookColors = [0x8b4513, 0xa0522d, 0x6b5344, 0x7f6946, 0x9a7b5b]
      const bookMat = new THREE.MeshStandardMaterial({
        color: bookColors[i],
        roughness: 0.7,
      })
      const book = new THREE.Mesh(
        new THREE.BoxGeometry(0.04, 0.15 + Math.random() * 0.05, 0.08),
        bookMat
      )
      const zPos = -wallLength / 2 + 2 + i * 2
      book.position.set(x - 0.12, shelfY + 0.1, zPos)
      book.castShadow = true
      scene.add(book)
    }
  }
}
