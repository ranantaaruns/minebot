'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const Vec3 = require('vec3')
const { horizontalSpeed, relativeSpeed, runupPoint, scanAhead, avoidancePoint, shouldStrike, isSolidBlock } = require('../src/combat/flight')

function botWithWall (wallX = 4) {
  const bot = {
    entity: { position: new Vec3(0, 70, 0), velocity: new Vec3(1, 0, 0), elytraFlying: true },
    blockAt: p => (Math.abs(p.x - wallX) < 0.6 && p.y >= 69 && p.y <= 73
      ? { name: 'stone', position: p }
      : { name: 'air', position: p })
  }
  return bot
}

test('horizontalSpeed hanya memakai X/Z', () => {
  assert.equal(horizontalSpeed({ velocity: new Vec3(3, 9, 4) }), 5)
})

test('relativeSpeed mengurangkan kecepatan target', () => {
  const self = { velocity: new Vec3(1.4, 0, 0) }
  assert.equal(relativeSpeed(self, { velocity: new Vec3(1.4, 0, 0) }), 0)
  assert.ok(Math.abs(relativeSpeed(self, { velocity: new Vec3(0.4, 0, 0) }) - 1) < 1e-9)
})

test('runupPoint berada di sisi bot yang menjauh dari target', () => {
  const p = runupPoint(new Vec3(0, 70, 0), new Vec3(10, 64, 0), 12, 4)
  assert.ok(p.x < -10, 'bot di barat target -> mundur lebih jauh ke barat')
  assert.equal(p.y, 74)
})

test('scanAhead menemukan blok sebelum bot menabrak', () => {
  const hit = scanAhead(botWithWall(), new Vec3(1, 0, 0), 8)
  assert.equal(hit.clear, false)
  assert.ok(hit.distance >= 3 && hit.distance <= 5)
})

test('scanAhead menganggap udara bersih', () => {
  const hit = scanAhead(botWithWall(99), new Vec3(1, 0, 0), 8)
  assert.equal(hit.clear, true)
})

test('scanAhead mendeteksi lantai pada lintasan menukik dan atap di ketinggian kepala', () => {
  const bot = botWithWall(99)
  bot.blockAt = p => (p.y <= 69 ? { name: 'stone', position: p } : { name: 'air', position: p })
  const floor = scanAhead(bot, new Vec3(0, -1, 0), 3)
  assert.equal(floor.clear, false)
  assert.equal(floor.offsetY, 0.2)

  bot.blockAt = p => (p.y >= 71 ? { name: 'stone', position: p } : { name: 'air', position: p })
  const roof = scanAhead(bot, new Vec3(0, 1, 0), 3)
  assert.equal(roof.clear, false)
  assert.equal(roof.offsetY, 1.4)
})

test('avoidancePoint mengalihkan lintasan ke atas saat ada tembok', () => {
  const bot = botWithWall()
  const result = avoidancePoint(bot, new Vec3(20, 70, 0), { distance: 8 })
  assert.equal(result.avoided, true)
  assert.ok(result.point.y > bot.entity.position.y + 2)
  assert.ok(result.point.x > 0, 'tetap mengarah ke depan, bukan berhenti')
})

test('avoidancePoint tidak mengubah tujuan bila lintasan kosong', () => {
  const bot = botWithWall(99)
  const target = new Vec3(20, 70, 0)
  const result = avoidancePoint(bot, target, { distance: 8 })
  assert.equal(result.avoided, false)
  assert.deepEqual(result.point, target)
})

test('shouldStrike mensyaratkan jarak spear dan kecepatan minimum', () => {
  assert.equal(shouldStrike({ distance: 3, speed: 1.4, minSpeed: 1 }), true)
  assert.equal(shouldStrike({ distance: 3, speed: 0.2, minSpeed: 1 }), false)
  assert.equal(shouldStrike({ distance: 1.2, speed: 2, minSpeed: 1 }), false)
  assert.equal(shouldStrike({ distance: 6, speed: 2, minSpeed: 1 }), false)
})

test('isSolidBlock mengabaikan udara dan fluida', () => {
  assert.equal(isSolidBlock(null), false)
  assert.equal(isSolidBlock({ name: 'air' }), false)
  assert.equal(isSolidBlock({ name: 'water' }), false)
  assert.equal(isSolidBlock({ name: 'stone' }), true)
})
