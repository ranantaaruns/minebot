'use strict'

const { TOOL_ORDER, TOOL_TIERS, toolName } = require('./sources')
const { findItemName } = require('../util/inventory')

const TOOL_TYPES = ['pickaxe', 'axe', 'shovel', 'hoe']

function rankOfTier (tier) {
  return TOOL_TIERS[tier] || 0
}

function nextTier (tier) {
  if (!tier) return 'wooden'
  const index = TOOL_ORDER.indexOf(tier)
  if (index === -1) return 'wooden'
  return TOOL_ORDER[Math.min(index + 1, TOOL_ORDER.length - 1)]
}

function tierForRank (rank) {
  if (rank <= 1) return 'wooden'
  if (rank === 2) return 'stone'
  if (rank === 3) return 'iron'
  if (rank === 4) return 'diamond'
  return 'netherite'
}

function findBestTool (bot, mcData, type) {
  if (type === 'shears') {
    const item = findItemName(bot, mcData, 'shears')
    return item ? { item, tier: null, rank: 0, name: 'shears' } : null
  }

  if (!TOOL_TYPES.includes(type)) return null

  for (let i = TOOL_ORDER.length - 1; i >= 0; i--) {
    const tier = TOOL_ORDER[i]
    const name = toolName(tier, type)
    const item = findItemName(bot, mcData, name)
    if (item) return { item, tier, rank: rankOfTier(tier), name }
  }
  return null
}

async function ensureTool (materials, type, tier, cancellation) {
  const { bot, mcData, logger } = materials
  const neededRank = tier ? rankOfTier(tier) : 0
  const best = findBestTool(bot, mcData, type)

  if (best && (type === 'shears' || best.rank >= neededRank)) return true

  if (type === 'shears') {
    const result = await materials.ensureItem('shears', 1, cancellation)
    return Boolean(result?.ok)
  }

  if (!TOOL_TYPES.includes(type)) return false

  const targetTier = best ? nextTier(best.tier) : tierForRank(neededRank)
  const finalTier = rankOfTier(targetTier) >= neededRank ? targetTier : tierForRank(neededRank)
  const name = toolName(finalTier, type)

  if (materials.inProgress.has(name)) {
    logger?.debug(`Tool ${name} sedang dibuat, hindari rekursi`)
    return false
  }

  logger?.info(`Membuat tool: ${name}`)
  materials.inProgress.add(name)
  try {
    const result = await materials.ensureItem(name, 1, cancellation)
    if (!result?.ok) return false
  } finally {
    materials.inProgress.delete(name)
  }

  const after = findBestTool(bot, mcData, type)
  return Boolean(after && after.rank >= neededRank)
}

module.exports = {
  ensureTool,
  findBestTool,
  nextTier,
  tierForRank,
  rankOfTier,
  TOOL_TYPES
}
