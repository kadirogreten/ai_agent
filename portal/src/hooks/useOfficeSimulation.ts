import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'

export interface AgentPosition {
  agentId: string
  name: string
  code: string
  role: string
  position: THREE.Vector3
  targetPosition: THREE.Vector3
  isMoving: boolean
  mesh?: THREE.Group
}

const ROLE_COLORS: Record<string, number> = {
  researcher: 0x3b82f6,     // blue
  analyst: 0x8b5cf6,        // purple
  writer: 0xec4899,         // pink
  editor: 0x10b981,         // emerald
  planner: 0xf59e0b,        // amber
  executor: 0xef4444,       // red
  default: 0x6366f1,        // indigo
}

export function useOfficeSimulation(scene: THREE.Scene | null) {
  const [agents, setAgents] = useState<AgentPosition[]>([])
  const agentsRef = useRef<Map<string, AgentPosition>>(new Map())
  const animationIdRef = useRef<number | null>(null)

  // Initialize agents at desk positions
  useEffect(() => {
    if (!scene) return

    const deskPositions = [
      { x: -12, z: 0 },
      { x: -6, z: -10 },
      { x: 0, z: -15 },
      { x: 6, z: -10 },
      { x: 12, z: 0 },
    ]

    const initAgents: AgentPosition[] = [
      {
        agentId: 'agent-1',
        name: 'Research Bot',
        code: 'rb-001',
        role: 'researcher',
        position: new THREE.Vector3(deskPositions[0].x, 2, deskPositions[0].z),
        targetPosition: new THREE.Vector3(deskPositions[0].x, 2, deskPositions[0].z),
        isMoving: false,
      },
      {
        agentId: 'agent-2',
        name: 'Analysis Bot',
        code: 'ab-001',
        role: 'analyst',
        position: new THREE.Vector3(deskPositions[1].x, 2, deskPositions[1].z),
        targetPosition: new THREE.Vector3(deskPositions[1].x, 2, deskPositions[1].z),
        isMoving: false,
      },
      {
        agentId: 'agent-3',
        name: 'Writing Bot',
        code: 'wb-001',
        role: 'writer',
        position: new THREE.Vector3(deskPositions[2].x, 2, deskPositions[2].z),
        targetPosition: new THREE.Vector3(deskPositions[2].x, 2, deskPositions[2].z),
        isMoving: false,
      },
      {
        agentId: 'agent-4',
        name: 'Edit Bot',
        code: 'eb-001',
        role: 'editor',
        position: new THREE.Vector3(deskPositions[3].x, 2, deskPositions[3].z),
        targetPosition: new THREE.Vector3(deskPositions[3].x, 2, deskPositions[3].z),
        isMoving: false,
      },
      {
        agentId: 'agent-5',
        name: 'Plan Bot',
        code: 'pb-001',
        role: 'planner',
        position: new THREE.Vector3(deskPositions[4].x, 2, deskPositions[4].z),
        targetPosition: new THREE.Vector3(deskPositions[4].x, 2, deskPositions[4].z),
        isMoving: false,
      },
    ]

    initAgents.forEach((agent) => {
      agentsRef.current.set(agent.agentId, agent)
      createAgentMesh(agent, scene)
    })

    setAgents(initAgents)
  }, [scene])

  // Create 3D mesh for agent
  function createAgentMesh(agent: AgentPosition, scene: THREE.Scene) {
    const group = new THREE.Group()
    group.position.copy(agent.position)

    // Agent body (sphere)
    const bodyGeometry = new THREE.SphereGeometry(0.6, 16, 16)
    const roleColor = ROLE_COLORS[agent.role] ?? ROLE_COLORS.default
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: roleColor,
      emissive: roleColor,
      emissiveIntensity: 0.5,
      roughness: 0.4,
      metalness: 0.6,
    })
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial)
    body.castShadow = true
    body.receiveShadow = true
    group.add(body)

    // Glow effect
    const glowGeometry = new THREE.SphereGeometry(0.7, 16, 16)
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: roleColor,
      transparent: true,
      opacity: 0.15,
    })
    const glow = new THREE.Mesh(glowGeometry, glowMaterial)
    group.add(glow)

    // Light above agent
    const light = new THREE.PointLight(roleColor, 1.5, 10)
    light.position.y = 2
    group.add(light)

    // Store metadata
    group.userData.agentId = agent.agentId
    group.userData.role = agent.role

    scene.add(group)
    agent.mesh = group
  }

  // Animation loop
  useEffect(() => {
    if (!scene || agents.length === 0) return

    const animate = () => {
      animationIdRef.current = requestAnimationFrame(animate)

      // Update agent positions
      agents.forEach((agent) => {
        if (!agent.mesh) return

        // Smooth movement toward target
        const delta = 0.05
        agent.position.lerp(agent.targetPosition, delta)
        agent.mesh.position.copy(agent.position)

        // Check if reached target
        const distance = agent.position.distanceTo(agent.targetPosition)
        if (distance < 0.1) {
          agent.isMoving = false
        }

        // Gentle bob animation
        agent.mesh.position.y += Math.sin(Date.now() * 0.002) * 0.02
      })
    }

    animate()

    return () => {
      if (animationIdRef.current !== null) {
        cancelAnimationFrame(animationIdRef.current)
      }
    }
  }, [scene, agents])

  // Move agent to position
  const moveAgentTo = (agentId: string, targetPos: THREE.Vector3) => {
    const agent = agentsRef.current.get(agentId)
    if (agent) {
      agent.targetPosition.copy(targetPos)
      agent.isMoving = true
    }
  }

  // Move agent to CEO zone
  const moveAgentToCeoZone = (agentId: string) => {
    moveAgentTo(agentId, new THREE.Vector3(0, 2, 5))
  }

  // Return agent to desk
  const returnAgentToDesk = (agentId: string, deskIndex: number) => {
    const deskPositions = [
      new THREE.Vector3(-12, 2, 0),
      new THREE.Vector3(-6, 2, -10),
      new THREE.Vector3(0, 2, -15),
      new THREE.Vector3(6, 2, -10),
      new THREE.Vector3(12, 2, 0),
    ]
    if (deskIndex < deskPositions.length) {
      moveAgentTo(agentId, deskPositions[deskIndex])
    }
  }

  return {
    agents,
    moveAgentTo,
    moveAgentToCeoZone,
    returnAgentToDesk,
  }
}
