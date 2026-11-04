'use strict'

const PAPER_PLAYER_HALF_WIDTH = 0.30001
const PAPER_PLAYER_HEIGHT = 1.80001

function positiveNumber (value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}

function applyPaperCollisionFix (bot, config = {}) {
  const options = config.physics || {}
  if (!options.paperCollisionFix) return false
  if (!bot?.physics) return false

  bot.physics.playerHalfWidth = positiveNumber(
    options.playerHalfWidth,
    PAPER_PLAYER_HALF_WIDTH
  )
  bot.physics.playerHeight = positiveNumber(
    options.playerHeight,
    PAPER_PLAYER_HEIGHT
  )
  return true
}

module.exports = {
  applyPaperCollisionFix,
  PAPER_PLAYER_HALF_WIDTH,
  PAPER_PLAYER_HEIGHT
}
