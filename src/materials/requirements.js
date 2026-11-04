'use strict'

const { stateKey } = require('../blueprint')

const NEVER_PLACEABLE = new Set([
  'water', 'lava', 'fire', 'soul_fire', 'spawner', 'bedrock', 'barrier', 'light',
  'command_block', 'chain_command_block', 'repeating_command_block',
  'structure_block', 'structure_void', 'jigsaw', 'end_portal', 'end_gateway',
  'nether_portal', 'portal', 'moving_piston', 'bubble_column', 'frosted_ice'
])

const CROP_BLOCKS = new Set([
  'wheat', 'carrots', 'potatoes', 'beetroots', 'sweet_berry_bush', 'cave_vines',
  'cave_vines_plant', 'torchflower_crop', 'pitcher_crop', 'nether_wart',
  'cocoa', 'melon_stem', 'pumpkin_stem', 'attached_melon_stem', 'attached_pumpkin_stem'
])

const DOUBLE_PLANTS = new Set([
  'tall_grass', 'large_fern', 'sunflower', 'lilac', 'rose_bush', 'peony',
  'tall_seagrass'
])

function bareName (name) {
  return name.startsWith('minecraft:') ? name.slice('minecraft:'.length) : name
}

function withNamespace (name) {
  return name.startsWith('minecraft:') ? name : `minecraft:${name}`
}

function specialItemName (name, properties = {}) {
  if (name === 'wall_torch') return 'torch'
  if (name === 'soul_wall_torch') return 'soul_torch'
  if (name === 'redstone_wall_torch') return 'redstone_torch'
  if (name === 'redstone_wire') return 'redstone'
  if (name === 'tripwire') return 'string'
  if (name.endsWith('_wall_sign')) return name.replace('_wall_sign', '_sign')
  if (name.endsWith('_wall_hanging_sign')) return name.replace('_wall_hanging_sign', '_hanging_sign')
  if (name.endsWith('_wall_banner')) return name.replace('_wall_banner', '_banner')
  if (name === 'grass_block' || name === 'mycelium' || name === 'podzol') return name
  if (properties.part === 'head' && name.endsWith('_bed')) return null
  return name
}

function findFallbackBlock (name, mcData) {
  if (name.endsWith('_stairs')) {
    const base = name.slice(0, -'_stairs'.length)
    if (mcData?.itemsByName?.[base]) return base
  }
  if (name.endsWith('_slab')) {
    const base = name.slice(0, -'_slab'.length)
    if (mcData?.itemsByName?.[base]) return base
  }
  if (name.endsWith('_wall')) {
    const base = name.slice(0, -'_wall'.length)
    if (mcData?.itemsByName?.[base]) return base
  }
  if (name.endsWith('_carpet')) {
    const base = name.slice(0, -'_carpet'.length) + '_wool'
    if (mcData?.itemsByName?.[base]) return base
  }
  return null
}

function resolveItemName (state, mcData) {
  const name = bareName(state.name)
  const properties = state.properties || {}

  if (NEVER_PLACEABLE.has(name)) {
    return { itemName: null, reason: 'blok tidak bisa didapat/dipasang sebagai item' }
  }
  if (CROP_BLOCKS.has(name)) {
    return { itemName: null, reason: 'tanaman/crop tidak didukung' }
  }
  if (DOUBLE_PLANTS.has(name)) {
    return { itemName: null, reason: 'tanaman dua blok tidak didukung' }
  }
  if (name.startsWith('potted_')) {
    return { itemName: null, reason: 'potted plant tidak didukung' }
  }
  if (name === 'farmland' || name === 'dirt_path') {
    return { itemName: null, reason: 'butuh hoe/shovel, tidak didukung otomatis' }
  }
  if (name.endsWith('_door') && properties.half === 'upper') {
    return { itemName: null, reason: 'separuh atas pintu otomatis dibuat' }
  }

  let itemName = specialItemName(name, properties)
  if (!itemName) {
    return { itemName: null, reason: 'bagian kedua blok otomatis dibuat' }
  }

  if (!mcData.itemsByName[itemName]) {
    const fallback = mcData.itemsByName[name]
    if (!fallback) {
      const baseFallback = findFallbackBlock(name, mcData)
      if (baseFallback) {
        return { itemName: baseFallback, fallbackName: baseFallback, reason: null }
      }
      return { itemName: null, reason: `tidak ada item untuk ${name}` }
    }
    itemName = name
  }

  return { itemName, reason: null }
}

function computeRequirements (blueprint, mcData) {
  const items = new Map()
  const unsupported = new Map()
  const skipped = new Map()
  let totalBlocks = 0

  for (const state of blueprint.states) {
    const key = stateKey(state.name, state.properties)
    const { itemName, reason } = resolveItemName(state, mcData)

    if (!itemName) {
      const bucket = reason && reason.includes('otomatis') ? skipped : unsupported
      const current = bucket.get(key) || { name: state.name, properties: state.properties, count: 0, reason }
      current.count += state.count
      bucket.set(key, current)
      continue
    }

    totalBlocks += state.count
    const item = mcData.itemsByName[itemName]
    const current = items.get(itemName) || {
      name: itemName,
      itemId: item.id,
      count: 0,
      states: new Set()
    }
    current.count += state.count
    current.states.add(key)
    items.set(itemName, current)
  }

  return {
    items,
    unsupported,
    skipped,
    totalBlocks,
    itemCount: items.size
  }
}

function summarizeRequirements (requirements) {
  const lines = []
  const sorted = [...requirements.items.values()].sort((a, b) => b.count - a.count)
  for (const item of sorted) {
    lines.push(`${item.name}: ${item.count}`)
  }
  return lines
}

module.exports = {
  computeRequirements,
  resolveItemName,
  summarizeRequirements,
  NEVER_PLACEABLE,
  bareName,
  withNamespace
}
