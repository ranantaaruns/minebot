'use strict'

const { LOG_TYPES } = require('./sources')

const WOOD_SUFFIXES = [
  'wall_hanging_sign', 'chest_boat', 'hanging_sign', 'pressure_plate',
  'fence_gate', 'wall_sign', 'trapdoor', 'stripped_log', 'stripped_wood',
  'planks', 'stairs', 'sapling', 'button', 'leaves', 'fence', 'mosaic',
  'block', 'floor', 'sign', 'door', 'slab', 'boat', 'wood', 'log'
]

const WOOD_BIOMES = {
  acacia: [
    'savanna', 'savanna_plateau', 'windswept_savanna', 'badlands',
    'eroded_badlands', 'wooded_badlands'
  ],
  bamboo: ['bamboo_jungle', 'jungle', 'sparse_jungle'],
  birch: ['birch_forest', 'old_growth_birch_forest', 'forest', 'flower_forest'],
  cherry: ['cherry_grove'],
  dark_oak: ['dark_forest', 'pale_garden'],
  jungle: ['jungle', 'sparse_jungle', 'bamboo_jungle'],
  mangrove: ['mangrove_swamp'],
  pale_oak: ['pale_garden'],
  spruce: [
    'taiga', 'snowy_taiga', 'old_growth_pine_taiga', 'old_growth_spruce_taiga',
    'windswept_forest', 'snowy_plains', 'grove', 'snowy_slopes', 'frozen_peaks'
  ]
}

const BIOME_WOOD = {
  savanna: 'acacia',
  savanna_plateau: 'acacia',
  windswept_savanna: 'acacia',
  badlands: 'acacia',
  eroded_badlands: 'acacia',
  wooded_badlands: 'acacia',
  bamboo_jungle: 'bamboo',
  jungle: 'jungle',
  sparse_jungle: 'jungle',
  birch_forest: 'birch',
  old_growth_birch_forest: 'birch',
  forest: 'oak',
  flower_forest: 'oak',
  cherry_grove: 'cherry',
  dark_forest: 'dark_oak',
  pale_garden: 'pale_oak',
  mangrove_swamp: 'mangrove',
  taiga: 'spruce',
  snowy_taiga: 'spruce',
  old_growth_pine_taiga: 'spruce',
  old_growth_spruce_taiga: 'spruce',
  windswept_forest: 'spruce',
  snowy_plains: 'spruce',
  grove: 'spruce',
  snowy_slopes: 'spruce',
  frozen_peaks: 'spruce',
  swamp: 'oak',
  plains: 'oak',
  meadow: 'oak',
  sunflower_plains: 'oak'
}

const SPECIAL_BIOMES = {
  cactus: ['desert'],
  red_sand: ['badlands', 'eroded_badlands', 'wooded_badlands'],
  terracotta: ['badlands', 'eroded_badlands', 'wooded_badlands'],
  packed_ice: ['frozen_ocean', 'deep_frozen_ocean', 'ice_spikes', 'frozen_peaks'],
  blue_ice: ['frozen_ocean', 'deep_frozen_ocean'],
  snow_block: [
    'snowy_taiga', 'snowy_plains', 'snowy_slopes', 'grove', 'ice_spikes', 'frozen_peaks'
  ],
  moss_block: ['lush_caves'],
  moss_carpet: ['lush_caves'],
  azalea: ['lush_caves'],
  flowering_azalea: ['lush_caves']
}

const SPECIAL_ALTERNATIVES = {
  red_sand: 'sand',
  packed_ice: 'ice',
  blue_ice: 'packed_ice',
  snow_block: 'snow',
  moss_block: 'grass_block',
  moss_carpet: 'short_grass',
  azalea: 'oak_leaves',
  flowering_azalea: 'oak_leaves'
}

function bareName (name) {
  return String(name || '').replace(/^minecraft:/, '')
}

function withNamespace (name) {
  return name.startsWith('minecraft:') ? name : `minecraft:${name}`
}

function getBiomeName (bot, position) {
  try {
    if (!bot || !position) return null
    const block = bot.blockAt(position)
    return block?.biome?.name || null
  } catch {
    return null
  }
}

function parseWoodName (name) {
  const raw = bareName(name)
  let body = raw
  let stripped = false
  if (body.startsWith('stripped_')) {
    body = body.slice('stripped_'.length)
    stripped = true
  }

  for (const suffix of WOOD_SUFFIXES) {
    if (!body.endsWith(`_${suffix}`)) continue
    const family = body.slice(0, -(suffix.length + 1))
    if (!LOG_TYPES.includes(family) && family !== 'pale_oak') continue
    return { family, suffix, stripped }
  }
  return null
}

function woodItemName (family, suffix, stripped = false) {
  return `${stripped ? 'stripped_' : ''}${family}_${suffix}`
}

function itemBiomeInfo (itemName) {
  const name = bareName(itemName)
  const wood = parseWoodName(name)
  if (wood && WOOD_BIOMES[wood.family]) {
    return {
      kind: 'wood',
      family: wood.family,
      suffix: wood.suffix,
      stripped: wood.stripped,
      biomes: WOOD_BIOMES[wood.family]
    }
  }
  if (SPECIAL_BIOMES[name]) {
    return { kind: 'item', family: name, suffix: null, stripped: false, biomes: SPECIAL_BIOMES[name] }
  }
  return null
}

function isBiomeAllowed (info, biomeName) {
  if (!info || !biomeName) return true
  return info.biomes.includes(biomeName)
}

function suggestedWoodFamily (biomeName) {
  return BIOME_WOOD[biomeName] || 'oak'
}

function substituteWoodItem (itemName, targetFamily) {
  const info = parseWoodName(itemName)
  if (!info) return null
  const candidate = woodItemName(targetFamily, info.suffix, info.stripped)
  if (candidate === bareName(itemName)) return null
  return candidate
}

function groupKey (info, itemName) {
  if (info.kind === 'wood') return `wood:${info.family}`
  return `item:${bareName(itemName)}`
}

function detectBiomeConflicts (requirements, biomeName, mcData) {
  if (!requirements || !biomeName) return []
  const groups = new Map()

  for (const item of requirements.items.values()) {
    const info = itemBiomeInfo(item.name)
    if (!info || isBiomeAllowed(info, biomeName)) continue
    if (mcData && !mcData.itemsByName[item.name]) continue

    const key = groupKey(info, item.name)
    const current = groups.get(key) || {
      key,
      kind: info.kind,
      family: info.family,
      biome: biomeName,
      allowedBiomes: info.biomes,
      items: [],
      total: 0
    }
    current.items.push({ name: item.name, count: item.count, info })
    current.total += item.count
    groups.set(key, current)
  }

  for (const group of groups.values()) {
    group.alternative = null
    if (group.kind === 'wood') {
      const family = suggestedWoodFamily(biomeName)
      if (family !== group.family) {
        group.alternative = {
          family,
          items: new Map(group.items.map(item => [
            item.name,
            substituteWoodItem(item.name, family)
          ]).filter(([, target]) => Boolean(target) && (!mcData || mcData.itemsByName[target])))
        }
      }
    } else if (SPECIAL_ALTERNATIVES[group.family]) {
      const target = SPECIAL_ALTERNATIVES[group.family]
      if (mcData?.itemsByName[target]) {
        group.alternative = {
          family: target,
          items: new Map(group.items.map(item => [item.name, target]))
        }
      }
    }
  }

  return [...groups.values()]
}

function customAlternative (input, group, mcData) {
  const raw = bareName(String(input || '').trim())
  if (!raw) return null

  if (group.kind === 'wood') {
    const parsed = parseWoodName(raw)
    const family = parsed ? parsed.family : (LOG_TYPES.includes(raw) || raw === 'pale_oak' ? raw : null)
    if (!family) return null
    const items = new Map()
    for (const item of group.items) {
      const target = substituteWoodItem(item.name, family)
      if (!target || !mcData?.itemsByName[target]) return null
      items.set(item.name, target)
    }
    return { family, items }
  }

  if (!mcData?.itemsByName[raw]) return null
  return { family: raw, items: new Map(group.items.map(item => [item.name, raw])) }
}

function applySubstitutions (requirements, substitutions, mcData) {
  if (!substitutions || substitutions.size === 0) return requirements
  const items = new Map()

  for (const item of requirements.items.values()) {
    const targetName = substitutions.get(item.name) || item.name
    const targetItem = mcData?.itemsByName[targetName]
    if (!targetItem) continue
    const current = items.get(targetName) || {
      name: targetName,
      itemId: targetItem.id,
      count: 0,
      states: new Set()
    }
    current.count += item.count
    for (const state of item.states || []) current.states.add(state)
    items.set(targetName, current)
  }

  return { ...requirements, items, itemCount: items.size }
}

function substituteBlockState (name, properties, substitutions, mcData) {
  const original = bareName(name)
  const target = substitutions?.get(original)
  if (!target) return { name, properties: properties || {} }
  if (!mcData?.blocksByName[target]) return null
  return { name: withNamespace(target), properties: properties || {} }
}

function formatConflict (group, maxItems = 6) {
  const parts = group.items
    .slice(0, maxItems)
    .map(item => `${item.name} x${item.count}`)
  if (group.items.length > maxItems) parts.push(`+${group.items.length - maxItems} jenis lain`)
  return parts.join(', ')
}

module.exports = {
  WOOD_BIOMES,
  BIOME_WOOD,
  SPECIAL_BIOMES,
  SPECIAL_ALTERNATIVES,
  bareName,
  getBiomeName,
  parseWoodName,
  woodItemName,
  itemBiomeInfo,
  isBiomeAllowed,
  suggestedWoodFamily,
  substituteWoodItem,
  detectBiomeConflicts,
  customAlternative,
  applySubstitutions,
  substituteBlockState,
  formatConflict
}
