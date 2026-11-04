'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  applyPaperCollisionFix,
  PAPER_PLAYER_HALF_WIDTH,
  PAPER_PLAYER_HEIGHT
} = require('../src/physics')

test('applyPaperCollisionFix expands the client hitbox for Paper 1.21.11', () => {
  const bot = { physics: { playerHalfWidth: 0.3, playerHeight: 1.8 } }

  assert.equal(applyPaperCollisionFix(bot, {
    physics: {
      paperCollisionFix: true,
      playerHalfWidth: 0.30002,
      playerHeight: 1.80002
    }
  }), true)
  assert.equal(bot.physics.playerHalfWidth, 0.30002)
  assert.equal(bot.physics.playerHeight, 1.80002)
})

test('applyPaperCollisionFix uses safe defaults for missing values', () => {
  const bot = { physics: { playerHalfWidth: 0.3, playerHeight: 1.8 } }

  assert.equal(applyPaperCollisionFix(bot, {
    physics: { paperCollisionFix: true }
  }), true)
  assert.equal(bot.physics.playerHalfWidth, PAPER_PLAYER_HALF_WIDTH)
  assert.equal(bot.physics.playerHeight, PAPER_PLAYER_HEIGHT)
})

test('applyPaperCollisionFix does nothing when disabled or physics is unavailable', () => {
  const bot = { physics: { playerHalfWidth: 0.3, playerHeight: 1.8 } }

  assert.equal(applyPaperCollisionFix(bot, {
    physics: { paperCollisionFix: false }
  }), false)
  assert.equal(bot.physics.playerHalfWidth, 0.3)

  assert.equal(applyPaperCollisionFix({}, {
    physics: { paperCollisionFix: true }
  }), false)
})
