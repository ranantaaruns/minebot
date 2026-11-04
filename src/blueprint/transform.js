'use strict'

// Urutan arah horizontal searah jarum jam bila dilihat dari atas.
// Dipakai untuk memutar facing blok: north -> east -> south -> west.
const HORIZONTAL = ['north', 'east', 'south', 'west']

const MIRROR_FACING = {
  x: { east: 'west', west: 'east' },
  z: { north: 'south', south: 'north' }
}

function normalizeRotate (rotate) {
  const value = Number(rotate || 0)
  if (!Number.isFinite(value) || value % 90 !== 0) {
    throw new Error('rotate harus kelipatan 90 derajat')
  }
  return ((value % 360) + 360) % 360
}

function normalizeMirror (mirror) {
  if (!mirror) return null
  const axis = String(mirror).toLowerCase()
  if (axis !== 'x' && axis !== 'z') throw new Error('mirror harus x atau z')
  return axis
}

function rotateFacing (facing, rotate) {
  const quarters = normalizeRotate(rotate) / 90
  const index = HORIZONTAL.indexOf(facing)
  if (index === -1) return facing
  return HORIZONTAL[(index + quarters) % 4]
}

function transformProperties (properties, options = {}) {
  const quarters = normalizeRotate(options.rotate) / 90
  const axis = normalizeMirror(options.mirror)
  const result = { ...(properties || {}) }
  if (quarters === 0 && !axis) return result

  if (typeof result.facing === 'string') {
    if (axis && MIRROR_FACING[axis][result.facing]) {
      result.facing = MIRROR_FACING[axis][result.facing]
    }
    if (quarters > 0) result.facing = rotateFacing(result.facing, quarters * 90)
  }

  if (quarters % 2 === 1 && (result.axis === 'x' || result.axis === 'z')) {
    result.axis = result.axis === 'x' ? 'z' : 'x'
  }

  if (axis && (result.hinge === 'left' || result.hinge === 'right')) {
    result.hinge = result.hinge === 'left' ? 'right' : 'left'
  }

  return result
}

// Mirror diterapkan lebih dulu, lalu rotasi - sama seperti structure block Minecraft
// (mirror selalu pada bounding box asli, bukan hasil rotasi).
function transformBlocks (blocks, options = {}) {
  const quarters = normalizeRotate(options.rotate) / 90
  const axis = normalizeMirror(options.mirror)
  if (quarters === 0 && !axis) return blocks.map(block => ({ ...block }))

  let maxX = -Infinity
  let maxZ = -Infinity
  for (const block of blocks) {
    maxX = Math.max(maxX, block.x)
    maxZ = Math.max(maxZ, block.z)
  }

  return blocks.map(block => {
    let x = block.x
    let z = block.z

    if (axis === 'x') x = maxX - x
    if (axis === 'z') z = maxZ - z

    for (let i = 0; i < quarters; i++) {
      const nextX = -z
      const nextZ = x
      x = nextX
      z = nextZ
    }

    return {
      ...block,
      x,
      y: block.y,
      z,
      properties: transformProperties(block.properties, { rotate: quarters * 90, mirror: axis })
    }
  })
}

module.exports = {
  HORIZONTAL,
  rotateFacing,
  transformProperties,
  transformBlocks
}
