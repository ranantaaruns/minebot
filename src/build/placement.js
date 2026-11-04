'use strict'

const Vec3 = require('vec3')

const INTERACTABLE = new Set([
  'chest', 'trapped_chest', 'barrel', 'ender_chest', 'shulker_box', 'furnace',
  'blast_furnace', 'smoker', 'crafting_table', 'cartography_table', 'fletching_table',
  'smithing_table', 'loom', 'stonecutter', 'grindstone', 'anvil', 'chipped_anvil',
  'damaged_anvil', 'enchanting_table', 'beacon', 'hopper', 'dropper', 'dispenser',
  'brewing_stand', 'lectern', 'cauldron', 'composter', 'respawn_anchor',
  'note_block', 'jukebox', 'lever', 'button', 'door', 'trapdoor', 'fence_gate',
  'bed', 'sign', 'banner', 'campfire', 'soul_campfire', 'flower_pot',
  'crafter', 'comparator', 'repeater', 'daylight_detector',
  'chiseled_bookshelf', 'decorated_pot', 'bell',
  'command_block', 'chain_command_block', 'repeating_command_block',
  'structure_block', 'jigsaw'
])

const FACING_VECTORS = {
  north: new Vec3(0, 0, -1),
  south: new Vec3(0, 0, 1),
  east: new Vec3(1, 0, 0),
  west: new Vec3(-1, 0, 0),
  up: new Vec3(0, 1, 0),
  down: new Vec3(0, -1, 0)
}

const DIRECTIONAL_FACING_OPPOSITE = new Set([
  'observer',
  'dispenser',
  'dropper',
  'piston',
  'sticky_piston',
  'crafter',
  'furnace',
  'blast_furnace',
  'smoker',
  'chest',
  'trapped_chest',
  'barrel',
  'ender_chest',
  'loom',
  'stonecutter',
  'repeater',
  'comparator'
])

const FACE_OFFSETS = [
  { offset: new Vec3(0, -1, 0), name: 'below' },
  { offset: new Vec3(0, 0, -1), name: 'north' },
  { offset: new Vec3(0, 0, 1), name: 'south' },
  { offset: new Vec3(-1, 0, 0), name: 'west' },
  { offset: new Vec3(1, 0, 0), name: 'east' },
  { offset: new Vec3(0, 1, 0), name: 'above' }
]

function bareName (name) {
  return name.startsWith('minecraft:') ? name.slice('minecraft:'.length) : name
}

function isStairs (name) {
  return bareName(name || '').endsWith('_stairs')
}

function isDoor (name) {
  return bareName(name || '').endsWith('_door')
}

function isTrapdoor (name) {
  return bareName(name || '').endsWith('_trapdoor')
}

function isDirectionalOpposite (name) {
  const bare = bareName(name || '')
  if (bare.endsWith('_stairs')) return true
  if (bare.endsWith('_furnace')) return true
  if (bare.endsWith('_chest')) return true
  return DIRECTIONAL_FACING_OPPOSITE.has(bare)
}

function blockProperties (block) {
  if (!block) return {}
  if (typeof block.getProperties === 'function') {
    try {
      return block.getProperties() || {}
    } catch {
      return {}
    }
  }
  return {}
}

function isAir (block) {
  return !block || block.name === 'air' || block.name === 'cave_air' || block.name === 'void_air'
}

function isLiquid (block) {
  return block && (block.name === 'water' || block.name === 'lava')
}

function isSolid (block) {
  return Boolean(block) && !isAir(block) && !isLiquid(block) && block.boundingBox !== 'empty'
}

function isInteractable (block) {
  if (!block) return false
  const name = bareName(typeof block === 'string' ? block : (block.name || ''))
  if (INTERACTABLE.has(name)) return true
  for (const token of INTERACTABLE) {
    if (name.endsWith(`_${token}`) || name === token) return true
  }
  return false
}

function isReplaceable (block) {
  if (isAir(block) || isLiquid(block)) return true
  if (!block) return false
  if (block.boundingBox === 'empty') return true
  return ['short_grass', 'grass', 'fern', 'dead_bush', 'snow', 'vine',
    'seagrass', 'tall_seagrass', 'fire', 'soul_fire'].includes(block.name)
}

function hasCollisionBox (mcData, name) {
  const bare = bareName(name)
  const def = mcData?.blocksByName?.[bare]
  if (!def) return true
  return def.boundingBox !== 'empty'
}

function collidesWithBlock (bot, blockPos, padding = 0.05) {
  const pos = bot?.entity?.position
  if (!pos || !blockPos) return false
  const halfWidth = (bot.physics?.playerHalfWidth ?? 0.3) + padding
  const height = (bot.physics?.playerHeight ?? 1.8) + padding

  return (
    pos.x + halfWidth > blockPos.x &&
    pos.x - halfWidth < blockPos.x + 1 &&
    pos.y + height > blockPos.y &&
    pos.y < blockPos.y + 1 &&
    pos.z + halfWidth > blockPos.z &&
    pos.z - halfWidth < blockPos.z + 1
  )
}

function matchesState (block, action) {
  if (!block) return false
  const bare = bareName(action.name)
  const fallback = action.fallbackName ? bareName(action.fallbackName) : null

  if (block.name !== bare) {
    if (fallback && block.name === fallback) {
      return true
    }
    return false
  }

  const desired = action.properties || {}
  const actual = blockProperties(block)

  for (const key of ['facing', 'half', 'type', 'axis', 'part', 'open', 'hinge', 'face', 'attachment']) {
    if (desired[key] !== undefined && actual[key] !== undefined && String(desired[key]) !== String(actual[key])) {
      return false
    }
  }
  return true
}

function eyePosition (bot) {
  return bot.entity.position.offset(0, 1.62, 0)
}

function distanceToTarget (bot, target) {
  return eyePosition(bot).distanceTo(target.offset(0.5, 0.5, 0.5))
}

function inReach (bot, target, reach = 4.2) {
  return distanceToTarget(bot, target) <= reach
}

function faceVectorFor (offset) {
  return new Vec3(
    offset.x === 0 ? 0 : -offset.x,
    offset.y === 0 ? 0 : -offset.y,
    offset.z === 0 ? 0 : -offset.z
  )
}

function orderedReferences (bot, target, action, mcData) {
  const bareActionName = bareName(action.name || '')
  const desired = action.properties || {}
  const desiredFacing = desired.facing || (desired.orientation ? desired.orientation.split('_')[0] : null)

  // 1. Special case: Hopper
  // Hopper facing in Minecraft is determined strictly by the clicked face of the reference block.
  // Direction = context.getClickedFace().getOpposite() (clamped if UP).
  if (bareActionName === 'hopper') {
    if (desiredFacing && desiredFacing !== 'down') {
      const requiredOffset = FACING_VECTORS[desiredFacing]
      if (requiredOffset) {
        const refPos = target.plus(requiredOffset)
        const block = bot.blockAt(refPos)
        if (isSolid(block)) {
          return [{
            block,
            refPos,
            face: faceVectorFor(requiredOffset),
            offset: requiredOffset,
            interactable: isInteractable(block)
          }]
        }
        // Hopper horizontal facing requires attachment to the block it points into.
        // If that block is not placed yet, defer placement so hopper doesn't face DOWN.
        return []
      }
    } else if (desiredFacing === 'down') {
      // Hopper facing down MUST attach to vertical surface (top of block below or bottom of block above).
      const verticalOffsets = [
        FACE_OFFSETS.find(f => f.offset.y === -1), // below
        FACE_OFFSETS.find(f => f.offset.y === 1)   // above
      ].filter(Boolean)

      const refs = []
      for (const face of verticalOffsets) {
        const refPos = target.plus(face.offset)
        const block = bot.blockAt(refPos)
        if (isSolid(block)) {
          refs.push({
            block,
            refPos,
            face: faceVectorFor(face.offset),
            offset: face.offset,
            interactable: isInteractable(block)
          })
        }
      }
      return refs
    }
  }

  // 2. Special case: Wall-mounted blocks (wall_torch, redstone_wall_torch, wall_sign, ladder, etc.)
  // Wall-mounted blocks with facing=X are mounted on the wall block in opposite direction (offset -X).
  const isWallMounted = bareActionName.includes('wall_') || bareActionName === 'ladder' || bareActionName === 'tripwire_hook'
  if (isWallMounted && desiredFacing && FACING_VECTORS[desiredFacing]) {
    const wallOffset = FACING_VECTORS[desiredFacing].scaled(-1)
    const refPos = target.plus(wallOffset)
    const block = bot.blockAt(refPos)
    if (isSolid(block)) {
      return [{
        block,
        refPos,
        face: faceVectorFor(wallOffset),
        offset: wallOffset,
        interactable: isInteractable(block)
      }]
    }
    // Wall block not present yet, defer
    return []
  }

  // 3. Special case: Doors
  // A door must be placed onto the solid floor block directly below it (clicking top face).
  if (isDoor(bareActionName)) {
    const belowOffset = new Vec3(0, -1, 0)
    const refPos = target.plus(belowOffset)
    const block = bot.blockAt(refPos)
    if (isSolid(block)) {
      return [{
        block,
        refPos,
        face: new Vec3(0, 1, 0),
        offset: belowOffset,
        interactable: isInteractable(block)
      }]
    }
    return []
  }

  // 4. Special case: Stairs
  // Normal stairs (half=bottom) require floor below or side blocks (cannot attach to block above).
  // Upside-down stairs (half=top) require block above (clicking bottom face) or side blocks.
  let preferred = FACE_OFFSETS
  if (isStairs(bareActionName)) {
    const half = desired.half || 'bottom'
    if (half === 'top') {
      preferred = [
        FACE_OFFSETS.find(f => f.offset.y === 1), // block above
        ...FACE_OFFSETS.filter(f => f.offset.y === 0) // side blocks
      ].filter(Boolean)
    } else {
      preferred = [
        FACE_OFFSETS.find(f => f.offset.y === -1), // floor below
        ...FACE_OFFSETS.filter(f => f.offset.y === 0) // side blocks
      ].filter(Boolean)
    }
  } else if (desired.axis === 'x') {
    preferred = FACE_OFFSETS.filter(face => face.offset.x !== 0)
  } else if (desired.axis === 'y') {
    preferred = FACE_OFFSETS.filter(face => face.offset.y !== 0)
  } else if (desired.axis === 'z') {
    preferred = FACE_OFFSETS.filter(face => face.offset.z !== 0)
  } else if (desiredFacing && desiredFacing !== 'up' && desiredFacing !== 'down') {
    const dir = FACING_VECTORS[desiredFacing]
    if (dir) {
      preferred = [
        ...FACE_OFFSETS.filter(face => face.offset.z === dir.z && face.offset.x === dir.x),
        ...FACE_OFFSETS
      ]
    }
  }

  const seen = new Set()
  const refs = []

  for (const face of preferred) {
    const key = `${face.offset.x},${face.offset.y},${face.offset.z}`
    if (seen.has(key)) continue
    seen.add(key)

    const refPos = target.plus(face.offset)
    const block = bot.blockAt(refPos)
    if (!isSolid(block)) continue

    refs.push({
      block,
      refPos,
      face: faceVectorFor(face.offset),
      offset: face.offset,
      interactable: isInteractable(block)
    })
  }

  return refs
}

function candidateStandingSpots (bot, target, options = {}) {
  const spots = []
  const radius = options.radius || 2
  const reach = options.reach || 4.2
  const y = target.y

  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      if (dx === 0 && dz === 0) continue
      if (Math.abs(dx) + Math.abs(dz) > radius + 1) continue

      for (const dy of [-1, 0, 1, 2]) {
        const feet = new Vec3(target.x + dx, y + dy, target.z + dz)
        spots.push(feet)
      }
    }
  }

  const seen = new Set()
  const valid = []
  for (const feet of spots) {
    const key = `${feet.x},${feet.y},${feet.z}`
    if (seen.has(key)) continue
    seen.add(key)

    const feetBlock = bot.blockAt(feet)
    const headBlock = bot.blockAt(feet.offset(0, 1, 0))
    const ground = bot.blockAt(feet.offset(0, -1, 0))

    if (!isAir(feetBlock) || !isAir(headBlock)) continue
    if (!options.allowAir && !isSolid(ground)) continue
    if (isLiquid(ground) || isLiquid(feetBlock)) continue

    const center = feet.offset(0.5, 0, 0.5)
    if (collidesWithBlock({ entity: { position: center } }, target)) continue

    const eye = center.offset(0, 1.62, 0)
    if (eye.distanceTo(target.offset(0.5, 0.5, 0.5)) > reach) continue

    const dist = bot.entity.position.distanceTo(center)
    valid.push({ feet, distance: dist })
  }

  valid.sort((a, b) => a.distance - b.distance)
  return valid
}

function interactableNearby (bot, action) {
  const desired = action.properties || {}
  if (INTERACTABLE.has(bareName(action.name))) return true
  if (desired.open === 'true' || desired.open === true) return true
  return false
}

module.exports = {
  Vec3,
  INTERACTABLE,
  FACING_VECTORS,
  DIRECTIONAL_FACING_OPPOSITE,
  FACE_OFFSETS,
  bareName,
  isStairs,
  isDoor,
  isTrapdoor,
  isDirectionalOpposite,
  blockProperties,
  isAir,
  isLiquid,
  isSolid,
  isInteractable,
  isReplaceable,
  hasCollisionBox,
  collidesWithBlock,
  matchesState,
  eyePosition,
  distanceToTarget,
  inReach,
  orderedReferences,
  candidateStandingSpots,
  interactableNearby
}
