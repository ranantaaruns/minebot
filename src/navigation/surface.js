'use strict'

const { Vec3 } = require('vec3')

function isAir (block) {
  return !block || block.name === 'air' || block.name === 'cave_air' || block.name === 'void_air'
}

function isSolid (block) {
  return Boolean(block) && !isAir(block) && block.boundingBox !== 'empty'
}

function isCovered (bot, position, scanHeight = 4) {
  if (!bot || !position) return false
  for (let dy = 1; dy <= scanHeight; dy++) {
    const block = bot.blockAt(new Vec3(position.x, position.y + dy, position.z), false)
    if (!block) return false
    if (isSolid(block) && !block.name.endsWith('_leaves')) return true
  }
  return false
}

function isSurfaceTarget (bot, target, options = {}) {
  if (!target) return false
  if (isCovered(bot, target, options.coverScanHeight ?? 4)) return false
  const below = bot?.blockAt?.(new Vec3(target.x, target.y - 1, target.z), false)
  return Boolean(below) && !isAir(below)
}

function createSurfaceExclusion (bot, target, options = {}) {
  const coverScanHeight = Number(options.coverScanHeight ?? 4)
  const maxDescent = Number(options.maxDescent ?? 2)
  const verticalThreshold = Number(options.verticalThreshold ?? 4)
  const startPos = bot?.entity?.position?.clone?.() || null
  const targetAbove = Boolean(startPos && target && target.y >= startPos.y + verticalThreshold)
  const targetOnSurface = isSurfaceTarget(bot, target, { coverScanHeight })

  return block => {
    if (!targetOnSurface || !block?.position) return 0
    const pos = block.position

    if (isCovered(bot, pos, coverScanHeight)) return 100

    if (targetAbove && startPos && pos.y < startPos.y - maxDescent) return 100

    return 0
  }
}

function applySurfaceExclusion (movements, bot, target, options = {}) {
  if (!movements || !bot || !target) return false
  if (options.surfaceBias === false) return false
  if (!isSurfaceTarget(bot, target, options)) return false
  movements.exclusionAreasStep.push(createSurfaceExclusion(bot, target, options))
  return true
}

module.exports = {
  isAir,
  isSolid,
  isCovered,
  isSurfaceTarget,
  createSurfaceExclusion,
  applySurfaceExclusion
}
