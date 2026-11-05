'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { FallTracker, fallDistanceFrom } = require('../src/combat/fall')

function botAt (y, onGround) {
  return { entity: { position: { x: 0, y, z: 0 }, onGround } }
}

test('fallDistanceFrom = peakY - y, tidak negatif', () => {
  assert.equal(fallDistanceFrom(70, 66.5), 3.5)
  assert.equal(fallDistanceFrom(70, 71), 0)
  assert.equal(fallDistanceFrom(undefined, 70), 0)
})

test('di tanah: jarak 0 dan apex ikut posisi sekarang', () => {
  const bot = botAt(64, true)
  const tracker = new FallTracker(bot)
  assert.equal(tracker.update(), 0)
  bot.entity.position.y = 70
  assert.equal(tracker.update(), 0)
  assert.equal(tracker.peakY, 70)
})

test('jatuh dari 70 ke 66 memberi 4.0', () => {
  const bot = botAt(70, false)
  const tracker = new FallTracker(bot)
  tracker.update()
  bot.entity.position.y = 66
  assert.equal(tracker.update(), 4)
})

test('naik dulu lalu jatuh: apex ikut kenaikan', () => {
  const bot = botAt(64, false)
  const tracker = new FallTracker(bot)
  tracker.update()
  bot.entity.position.y = 69
  tracker.update()
  bot.entity.position.y = 67.5
  assert.equal(tracker.update(), 1.5)
})

test('reset mengosongkan apex', () => {
  const bot = botAt(70, false)
  const tracker = new FallTracker(bot)
  tracker.update()
  tracker.reset()
  assert.equal(tracker.peakY, null)
  assert.equal(tracker.distance, 0)
})
