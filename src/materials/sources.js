'use strict'

const LOG_TYPES = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry', 'pale_oak']

function logSources () {
  const out = {}
  for (const type of LOG_TYPES) {
    out[`${type}_log`] = { blocks: [`${type}_log`] }
    out[`${type}_wood`] = { blocks: [`${type}_wood`] }
    out[`${type}_planks`] = { craftOnly: true }
  }
  return out
}

const MINE_SOURCES = {
  ...logSources(),

  cobblestone: { blocks: ['stone', 'cobblestone'], tool: 'pickaxe', tier: 'wooden' },
  stone: { blocks: ['stone'], tool: 'pickaxe', tier: 'wooden', requiresSilk: true },
  deepslate: { blocks: ['deepslate'], tool: 'pickaxe', tier: 'wooden', requiresSilk: true },
  cobbled_deepslate: { blocks: ['deepslate'], tool: 'pickaxe', tier: 'wooden' },
  sand: { blocks: ['sand'], tool: 'shovel', tier: 'wooden' },
  red_sand: { blocks: ['red_sand'], tool: 'shovel', tier: 'wooden' },
  gravel: { blocks: ['gravel'], tool: 'shovel', tier: 'wooden' },
  dirt: { blocks: ['dirt', 'coarse_dirt', 'rooted_dirt', 'grass_block', 'podzol', 'mycelium'], tool: 'shovel', tier: 'wooden' },
  grass_block: { blocks: ['grass_block'], tool: 'shovel', tier: 'wooden', requiresSilk: true },
  mycelium: { blocks: ['mycelium'], tool: 'shovel', tier: 'wooden', requiresSilk: true },
  podzol: { blocks: ['podzol'], tool: 'shovel', tier: 'wooden', requiresSilk: true },
  clay_ball: { blocks: ['clay'], tool: 'shovel', tier: 'wooden' },
  snowball: { blocks: ['snow', 'snow_block'], tool: 'shovel', tier: 'wooden' },
  ice: { blocks: ['ice', 'packed_ice', 'blue_ice'], tool: 'pickaxe', tier: 'wooden', requiresSilk: true },

  coal: { blocks: ['coal_ore', 'deepslate_coal_ore'], tool: 'pickaxe', tier: 'wooden' },
  raw_iron: { blocks: ['iron_ore', 'deepslate_iron_ore'], tool: 'pickaxe', tier: 'stone' },
  raw_copper: { blocks: ['copper_ore', 'deepslate_copper_ore'], tool: 'pickaxe', tier: 'stone' },
  raw_gold: { blocks: ['gold_ore', 'deepslate_gold_ore'], tool: 'pickaxe', tier: 'iron' },
  redstone: { blocks: ['redstone_ore', 'deepslate_redstone_ore'], tool: 'pickaxe', tier: 'iron' },
  lapis_lazuli: { blocks: ['lapis_ore', 'deepslate_lapis_ore'], tool: 'pickaxe', tier: 'stone' },
  diamond: { blocks: ['diamond_ore', 'deepslate_diamond_ore'], tool: 'pickaxe', tier: 'iron' },
  emerald: { blocks: ['emerald_ore', 'deepslate_emerald_ore'], tool: 'pickaxe', tier: 'iron' },
  quartz: { blocks: ['nether_quartz_ore'], tool: 'pickaxe', tier: 'wooden' },
  amethyst_shard: { blocks: ['amethyst_cluster', 'large_amethyst_bud', 'medium_amethyst_bud', 'small_amethyst_bud'], tool: 'pickaxe', tier: 'stone' },

  netherrack: { blocks: ['netherrack'], tool: 'pickaxe', tier: 'wooden' },
  soul_sand: { blocks: ['soul_sand'], tool: 'shovel', tier: 'wooden' },
  soul_soil: { blocks: ['soul_soil'], tool: 'shovel', tier: 'wooden' },
  blackstone: { blocks: ['blackstone'], tool: 'pickaxe', tier: 'wooden' },
  basalt: { blocks: ['basalt'], tool: 'pickaxe', tier: 'wooden' },
  end_stone: { blocks: ['end_stone'], tool: 'pickaxe', tier: 'wooden' },
  obsidian: { blocks: ['obsidian'], tool: 'pickaxe', tier: 'diamond' },
  ancient_debris: { blocks: ['ancient_debris'], tool: 'pickaxe', tier: 'diamond' },

  string: { blocks: ['cobweb'], tool: 'shears', tier: null },

  bamboo: { blocks: ['bamboo'], tier: null },
  bamboo_block: { craftOnly: true },
  bamboo_planks: { craftOnly: true }
}

for (const type of LOG_TYPES) {
  MINE_SOURCES[`${type}_leaves`] = { blocks: [`${type}_leaves`], tool: 'shears', tier: null }
}

const SMELT_SOURCES = {
  stone: { input: 'cobblestone' },
  smooth_stone: { input: 'stone' },
  glass: { input: 'sand' },
  brick: { input: 'clay_ball' },
  charcoal: { inputAnyLog: true },
  nether_brick: { input: 'netherrack' },
  iron_ingot: { inputPreferred: ['raw_iron', 'iron_ore'] },
  gold_ingot: { inputPreferred: ['raw_gold', 'gold_ore'] },
  copper_ingot: { inputPreferred: ['raw_copper', 'copper_ore'] },
  smooth_basalt: { input: 'basalt' },
  cracked_stone_bricks: { input: 'stone_bricks' }
}

const FUEL_PREFERENCE = [
  'coal', 'charcoal', 'coal_block', 'oak_planks', 'spruce_planks', 'birch_planks',
  'oak_log', 'spruce_log', 'birch_log', 'stick'
]

const FUEL_VALUE = {
  coal: 8,
  charcoal: 8,
  coal_block: 80,
  oak_planks: 1.5,
  spruce_planks: 1.5,
  birch_planks: 1.5,
  oak_log: 1.5,
  spruce_log: 1.5,
  birch_log: 1.5,
  stick: 0.5
}

const TOOL_TIERS = {
  wooden: 1,
  golden: 1,
  stone: 2,
  iron: 3,
  diamond: 4,
  netherite: 5
}

const TOOL_ORDER = ['wooden', 'stone', 'iron', 'diamond', 'netherite']

function toolName (tier, type) {
  if (type === 'shears') return 'shears'
  return `${tier}_${type}`
}

module.exports = {
  LOG_TYPES,
  MINE_SOURCES,
  SMELT_SOURCES,
  FUEL_PREFERENCE,
  FUEL_VALUE,
  TOOL_TIERS,
  TOOL_ORDER,
  toolName
}
