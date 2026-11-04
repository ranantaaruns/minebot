'use strict'

const Vec3 = require('vec3')

const FORTRESS_BLOCKS = new Set([
  'nether_bricks',
  'nether_brick_fence',
  'nether_brick_stairs',
  'nether_brick_slab',
  'nether_brick_wall',
  'red_nether_bricks',
  'red_nether_brick_stairs',
  'red_nether_brick_slab',
  'chiseled_nether_bricks',
  'cracked_nether_bricks'
])

const FORTRESS_ENTITIES = new Set([
  'blaze',
  'wither_skeleton'
])

const BASTION_BLOCKS = new Set([
  'polished_blackstone_bricks',
  'cracked_polished_blackstone_bricks',
  'gilded_blackstone',
  'chiseled_polished_blackstone',
  'polished_blackstone_brick_stairs',
  'polished_blackstone_brick_slab',
  'polished_blackstone_brick_wall',
  'crying_obsidian'
])

const BASTION_ENTITIES = new Set([
  'piglin_brute'
])

const LAVA_BLOCKS = new Set([
  'lava',
  'flowing_lava'
])

const FIRE_BLOCKS = new Set([
  'fire',
  'soul_fire'
])

function isNether (bot) {
  if (!bot) return false
  const dim = bot.game?.dimension
  if (typeof dim === 'string') {
    return dim.toLowerCase().includes('nether')
  }
  if (dim && typeof dim === 'object') {
    const name = dim.name || dim.effects || ''
    return String(name).toLowerCase().includes('nether')
  }
  if (typeof dim === 'number') {
    return dim === -1
  }
  return false
}

function findNearbyPortal (bot, pos, radius = 4) {
  if (!bot?.blockAt || !pos) return null
  const center = pos.floored()
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const check = center.offset(dx, dy, dz)
        const block = bot.blockAt(check)
        if (block && (block.name === 'nether_portal' || block.name === 'portal')) {
          return check
        }
      }
    }
  }
  return null
}

function isSafeFromLava (bot, pos) {
  if (!bot?.blockAt || !pos) return true
  const offsets = [
    new Vec3(0, 1, 0),   // above
    new Vec3(0, -1, 0),  // below
    new Vec3(1, 0, 0),   // east
    new Vec3(-1, 0, 0),  // west
    new Vec3(0, 0, 1),   // south
    new Vec3(0, 0, -1)   // north
  ]

  for (const off of offsets) {
    const checkPos = pos.plus(off)
    const block = bot.blockAt(checkPos)
    if (block && LAVA_BLOCKS.has(block.name)) {
      return false
    }
  }

  // Also check 2 blocks above for falling gravel/sand holding lava
  const above2 = pos.offset(0, 2, 0)
  const blockAbove2 = bot.blockAt(above2)
  if (blockAbove2 && LAVA_BLOCKS.has(blockAbove2.name)) {
    return false
  }

  return true
}

function hasGoldArmor (bot) {
  if (!bot?.inventory?.slots) return false
  const armorSlots = [5, 6, 7, 8] // helmet, chestplate, leggings, boots
  return armorSlots.some(slot => {
    const item = bot.inventory.slots[slot]
    return item && (item.name.startsWith('golden_') || item.name.includes('gold'))
  })
}

function findGoldArmorInInventory (bot) {
  const items = bot?.inventory?.items?.() || []
  return items.find(item => item.name.startsWith('golden_') && (
    item.name.endsWith('_helmet') ||
    item.name.endsWith('_chestplate') ||
    item.name.endsWith('_leggings') ||
    item.name.endsWith('_boots')
  )) || null
}

async function ensureGoldArmor (bot) {
  if (hasGoldArmor(bot)) return true
  const gold = findGoldArmorInInventory(bot)
  if (!gold) return false
  const dest = gold.name.endsWith('_helmet') ? 'head'
    : gold.name.endsWith('_chestplate') ? 'torso'
    : gold.name.endsWith('_leggings') ? 'legs' : 'feet'
  try {
    await bot.equip(gold, dest)
    return true
  } catch {
    return false
  }
}

class StructureAvoidance {
  constructor (bot, options = {}, logger = null) {
    this.bot = bot
    this.options = options
    this.logger = logger
    this.zones = [] // { type: 'fortress'|'bastion', center: Vec3, radius: number, expiresAt: number }
    this.avoidRadius = Number(options.structureAvoidRadius || options.avoidRadius) || 48
    this.enabled = options.avoidStructures !== false
    this.lastScanAt = 0
  }

  scan () {
    if (!this.enabled || !isNether(this.bot)) return
    const now = Date.now()
    if (now - this.lastScanAt < 2000) return
    this.lastScanAt = now

    // Clean expired zones (older than 10 minutes)
    this.zones = this.zones.filter(z => z.expiresAt > now)

    // 1. Scan entities
    for (const entity of Object.values(this.bot.entities || {})) {
      if (!entity?.name || !entity.position) continue
      const name = entity.name.toLowerCase()
      if (FORTRESS_ENTITIES.has(name)) {
        this._recordZone('fortress', entity.position)
      } else if (BASTION_ENTITIES.has(name)) {
        this._recordZone('bastion', entity.position)
      }
    }

    // 2. Scan loaded blocks around bot
    if (this.bot.findBlocks) {
      this._scanBlocks()
    }
  }

  _scanBlocks () {
    const mcData = require('minecraft-data')(this.bot.version || '1.21.1')
    if (!mcData?.blocksByName) return

    // Scan fortress blocks
    const fortressIds = [...FORTRESS_BLOCKS]
      .map(name => mcData.blocksByName[name]?.id)
      .filter(id => id !== undefined)

    if (fortressIds.length > 0) {
      try {
        const found = this.bot.findBlocks({
          matching: fortressIds,
          maxDistance: 24,
          count: 5
        })
        if (found.length >= 3) {
          const avg = found.reduce((acc, p) => acc.plus(p), new Vec3(0, 0, 0)).scaled(1 / found.length)
          this._recordZone('fortress', avg)
        }
      } catch {}
    }

    // Scan bastion blocks
    const bastionIds = [...BASTION_BLOCKS]
      .map(name => mcData.blocksByName[name]?.id)
      .filter(id => id !== undefined)

    if (bastionIds.length > 0) {
      try {
        const found = this.bot.findBlocks({
          matching: bastionIds,
          maxDistance: 24,
          count: 5
        })
        if (found.length >= 3) {
          const avg = found.reduce((acc, p) => acc.plus(p), new Vec3(0, 0, 0)).scaled(1 / found.length)
          this._recordZone('bastion', avg)
        }
      } catch {}
    }
  }

  _recordZone (type, pos) {
    const now = Date.now()
    const center = pos.floored()
    // Check if zone already exists nearby
    const existing = this.zones.find(z => z.type === type && z.center.distanceTo(center) < 32)
    if (existing) {
      existing.expiresAt = now + 600000 // 10 minutes
      return
    }

    const zone = {
      type,
      center,
      radius: this.avoidRadius,
      expiresAt: now + 600000
    }
    this.zones.push(zone)
    this.logger?.warn(`[Nether] Terdeteksi struktur berbahaya ${type.toUpperCase()} di (${center.x}, ${center.y}, ${center.z})! Menghindari area radius ${this.avoidRadius} blok.`)
  }

  isInsideDangerZone (pos, margin = 0) {
    if (!this.enabled || !isNether(this.bot) || !pos) return false
    return this.zones.some(z => pos.distanceTo(z.center) <= (z.radius + margin))
  }

  getNearestZone (pos) {
    if (!pos || this.zones.length === 0) return null
    let nearest = null
    let minDistance = Infinity
    for (const z of this.zones) {
      const d = pos.distanceTo(z.center)
      if (d < minDistance) {
        minDistance = d
        nearest = { ...z, distance: d }
      }
    }
    return nearest
  }

  getRetreatVector (bot) {
    const pos = bot?.entity?.position
    if (!pos || this.zones.length === 0) return new Vec3(0, 0, 1)

    const nearest = this.getNearestZone(pos)
    if (!nearest) return new Vec3(0, 0, 1)

    const diff = pos.minus(nearest.center)
    const horizontalDist = Math.hypot(diff.x, diff.z)
    if (horizontalDist < 0.01) {
      return new Vec3(0, 0, 1)
    }
    return new Vec3(diff.x / horizontalDist, 0, diff.z / horizontalDist)
  }

  createStructureExclusion () {
    return block => {
      if (!this.enabled || !block?.position) return 0
      for (const zone of this.zones) {
        if (block.position.distanceTo(zone.center) <= zone.radius) {
          return 1000 // Severe step penalty to force pathfinder away from fortress/bastion
        }
      }
      return 0
    }
  }
}

function createLavaExclusion (bot) {
  return block => {
    if (!block?.position || !bot?.blockAt) return 0
    const b = bot.blockAt(block.position)
    if (!b) return 0
    if (LAVA_BLOCKS.has(b.name) || FIRE_BLOCKS.has(b.name)) {
      return 1000
    }
    // Check neighbor blocks for lava or fire
    if (!isSafeFromLava(bot, block.position)) {
      return 500
    }
    return 0
  }
}

module.exports = {
  isNether,
  findNearbyPortal,
  isSafeFromLava,
  hasGoldArmor,
  findGoldArmorInInventory,
  ensureGoldArmor,
  FORTRESS_BLOCKS,
  FORTRESS_ENTITIES,
  BASTION_BLOCKS,
  BASTION_ENTITIES,
  LAVA_BLOCKS,
  FIRE_BLOCKS,
  StructureAvoidance,
  createLavaExclusion
}
