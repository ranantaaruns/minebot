'use strict'

const { Movements } = require('mineflayer-pathfinder')
const Move = require('mineflayer-pathfinder/lib/move')
const mcDataLoader = require('minecraft-data')
const { applySurfaceExclusion } = require('./navigation/surface')
const { isNether, createLavaExclusion } = require('./safety/nether')
const { CLIMBABLE_NAMES } = require('./navigation/ladder')

function resolveScaffoldIds (bot, names) {
  if (!Array.isArray(names) || names.length === 0) return []
  let mcData
  try {
    mcData = mcDataLoader(bot.version)
  } catch {
    return []
  }

  const ids = []
  for (const name of names) {
    const item = mcData.itemsByName[String(name).replace(/^minecraft:/, '')]
    if (item && !ids.includes(item.id)) ids.push(item.id)
  }
  return ids
}

function enhanceLadderMovements (movements, bot) {
  let mcData
  try {
    mcData = bot.registry || mcDataLoader(bot.version)
  } catch {
    return movements
  }
  if (!mcData?.blocksByName) return movements

  // 1. Populate all climbable blocks
  if (movements.climbables) {
    for (const name of CLIMBABLE_NAMES) {
      const b = mcData.blocksByName[name]
      if (b && !movements.climbables.has(b.id)) {
        movements.climbables.add(b.id)
      }
    }
  }

  // 2. Enable opening doors, gates, and trapdoors
  movements.canOpenDoors = true
  if (movements.openable && Array.isArray(mcData.blocksArray)) {
    for (const b of mcData.blocksArray) {
      if (b.name.endsWith('_trapdoor') && !b.name.includes('iron')) {
        movements.openable.add(b.id)
      }
      if (b.name.endsWith('_door') && !b.name.includes('iron')) {
        movements.openable.add(b.id)
      }
    }
  }

  // 3. Patch getBlock: Climbables should NOT be considered solid physical obstacles
  const origGetBlock = movements.getBlock.bind(movements)
  movements.getBlock = function (pos, dx, dy, dz) {
    const b = origGetBlock(pos, dx, dy, dz)
    if (b && b.climbable) {
      b.physical = false
      b.safe = true
      b.height = pos.y + dy
    }
    return b
  }

  // 4. Patch getMoveForward: When stepping onto/into a climbable block from above or beside,
  // do not require scaffolding block placement!
  const origGetMoveForward = movements.getMoveForward.bind(movements)
  movements.getMoveForward = function (node, dir, neighbors) {
    const blockC = this.getBlock(node, dir.x, 0, dir.z)
    const blockD = this.getBlock(node, dir.x, -1, dir.z)
    if (blockD.climbable || blockC.climbable) {
      const blockB = this.getBlock(node, dir.x, 1, dir.z)
      if (blockB.safe && blockC.safe) {
        const targetY = blockC.climbable ? node.y : node.y - 1
        neighbors.push(new Move(node.x + dir.x, targetY, node.z + dir.z, node.remainingBlocks, 1, [], []))
        return
      }
    }
    origGetMoveForward(node, dir, neighbors)
  }

  // 5. Patch getMoveDown: When current block or block below is climbable, allow moving down 1 block on ladder
  const origGetMoveDown = movements.getMoveDown.bind(movements)
  movements.getMoveDown = function (node, neighbors) {
    const blockCurrent = this.getBlock(node, 0, 0, 0)
    const blockBelow = this.getBlock(node, 0, -1, 0)
    if (blockBelow.climbable || (blockCurrent.climbable && !blockBelow.physical)) {
      neighbors.push(new Move(node.x, node.y - 1, node.z, node.remainingBlocks, 1, [], []))
      return
    }
    origGetMoveDown(node, neighbors)
  }

  return movements
}

function applyMovements (bot, mode = 'travel', options = {}) {
  const movements = new Movements(bot)
  const followMode = mode === 'travel' || mode === 'follow'
  const towerIds = followMode ? resolveScaffoldIds(bot, options.towerBlocks) : []
  const allowTower = followMode && options.allowTower !== false

  const liquidCost = Number(options.liquidCost ?? options.swim?.liquidCost)
  const inNether = isNether(bot)

  movements.canDig = mode === 'gather'
  movements.allow1by1towers = allowTower && towerIds.length > 0
  movements.allowParkour = mode !== 'build'
  movements.allowSprinting = mode !== 'build' && options.allowSprinting !== false
  movements.maxDropDown = inNether ? 2 : (mode === 'build' ? 2 : 4)
  movements.scafoldingBlocks = towerIds
  movements.liquidCost = inNether
    ? 2000
    : (mode === 'gather'
      ? 10
      : (Number.isFinite(liquidCost) && liquidCost >= 0 ? liquidCost : 1000))

  if (inNether) {
    movements.dontMineUnderFallingBlock = true
    movements.exclusionAreasStep.push(createLavaExclusion(bot))
    if (bot.structureAvoidance && options.avoidStructures !== false) {
      movements.exclusionAreasStep.push(bot.structureAvoidance.createStructureExclusion())
    }
  }

  if (mode === 'gather') {
    movements.digCost = 8
    movements.placeCost = 100
  } else if (followMode) {
    movements.placeCost = Number(options.towerPlaceCost) || 40
  }

  if (mode === 'follow' && options.surfaceTarget) {
    applySurfaceExclusion(movements, bot, options.surfaceTarget, {
      ...(options.navigation || {}),
      surfaceBias: options.navigation?.surfaceBias !== false
    })
  }

  enhanceLadderMovements(movements, bot)

  bot.pathfinder.setMovements(movements)
  return movements
}

module.exports = { applyMovements, resolveScaffoldIds, enhanceLadderMovements }
