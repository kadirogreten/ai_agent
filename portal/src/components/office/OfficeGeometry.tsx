import { useEffect } from 'react'
import * as THREE from 'three'

interface OfficeGeometryProps {
  scene: THREE.Scene
}

export default function OfficeGeometry({ scene }: OfficeGeometryProps) {
  useEffect(() => {
    console.log('OfficeGeometry: Creating floor and geometry...')

    // Floor - enhanced with checkerboard pattern
    const floorGeometry = new THREE.PlaneGeometry(40, 40, 4, 4)
    const floorMaterial = new THREE.MeshStandardMaterial({
      color: 0x1a2332,
      roughness: 0.5,
      metalness: 0.2,
    })
    const floor = new THREE.Mesh(floorGeometry, floorMaterial)
    floor.rotation.x = -Math.PI / 2
    floor.receiveShadow = true
    scene.add(floor)
    console.log('OfficeGeometry: Floor added to scene')

    // Grid helper for visual reference - brighter colors
    const gridHelper = new THREE.GridHelper(40, 8, 0x6b7280, 0x2d3748)
    gridHelper.position.y = 0.02
    scene.add(gridHelper)

    // Walls - more visible with better contrast
    const wallMaterial = new THREE.MeshStandardMaterial({
      color: 0x1e2d42,
      roughness: 0.7,
      metalness: 0.15,
    })

    // North wall
    const northWall = new THREE.Mesh(
      new THREE.BoxGeometry(40, 4, 0.2),
      wallMaterial
    )
    northWall.position.set(0, 2, -20)
    northWall.castShadow = true
    northWall.receiveShadow = true
    scene.add(northWall)

    // South wall
    const southWall = new THREE.Mesh(
      new THREE.BoxGeometry(40, 4, 0.2),
      wallMaterial
    )
    southWall.position.set(0, 2, 20)
    southWall.castShadow = true
    southWall.receiveShadow = true
    scene.add(southWall)

    // East wall
    const eastWall = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 4, 40),
      wallMaterial
    )
    eastWall.position.set(20, 2, 0)
    eastWall.castShadow = true
    eastWall.receiveShadow = true
    scene.add(eastWall)

    // West wall
    const westWall = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 4, 40),
      wallMaterial
    )
    westWall.position.set(-20, 2, 0)
    westWall.castShadow = true
    westWall.receiveShadow = true
    scene.add(westWall)

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

    // CEO Meeting Zone (center area) - more prominent
    const ceoZone = new THREE.Mesh(
      new THREE.CylinderGeometry(7, 7, 0.15, 32),
      new THREE.MeshStandardMaterial({
        color: 0xa78bfa,
        emissive: 0x8b5cf6,
        emissiveIntensity: 0.5,
        roughness: 0.3,
        metalness: 0.5,
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
      color: 0x7c3aed,
      emissive: 0xa78bfa,
      emissiveIntensity: 0.8,
    })
    const ring = new THREE.Mesh(ringGeometry, ringMaterial)
    ring.position.set(0, 0.5, 5)
    ring.rotation.x = Math.PI / 2
    scene.add(ring)

    // Brighter glow for CEO zone
    const ceoGlow = new THREE.PointLight(0xa78bfa, 3, 25)
    ceoGlow.position.set(0, 4, 5)
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
