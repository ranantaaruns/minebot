'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const EventEmitter = require('node:events')
const Vec3 = require('vec3')
const { ShieldGuard, findShield } = require('../src/safety/shield')

const silentLogger = { info () {}, warn () {}, debug () {}, error () {} }

function shieldBot ({ withShield = true } = {}) {
  const bot = new EventEmitter()
  const inventory = []
  if (withShield) inventory.push({ name: 'shield', type: 442, count: 1 })
  inventory.push({ name: 'diamond_sword', type: 276, count: 1 })

  bot.entity = { position: new Vec3(0, 64, 0), height: 1.8, id: 1 }
  bot.health = 20
  bot.heldItem = inventory[inventory.length - 1]
  bot.inventory = {
    items: () => inventory,
    slots: []
  }
  bot.equipped = []
  bot.activateCalls = []
  bot.deactivateCalls = 0
  bot.equip = async (item, destination) => {
    bot.equipped.push({ name: item.name, destination })
    if (destination === 'off-hand') bot.inventory.slots[45] = item
  }
  bot.activateItem = offHand => { bot.activateCalls.push(Boolean(offHand)) }
  bot.deactivateItem = () => { bot.deactivateCalls++ }
  return bot
}

function enemyAt (x, z = 0) {
  return { id: 99, username: 'Steve', position: new Vec3(x, 64, z), velocity: new Vec3(0, 0, 0), height: 1.8 }
}

test('shield dipasang di off-hand lalu diangkat saat lawan dalam jangkauan', async () => {
  const bot = shieldBot()
  const guard = new ShieldGuard(bot, { shield: { blockRange: 4.5 } }, silentLogger)

  assert.equal(guard.hasShield(), true)
  const raised = await guard.update(enemyAt(3), 3)

  assert.equal(raised, true)
  assert.deepEqual(bot.equipped, [{ name: 'shield', destination: 'off-hand' }])
  assert.deepEqual(bot.activateCalls, [true], 'activateItem dipanggil untuk off-hand')
  assert.equal(guard.blocking, true)
})

test('ayunan lawan diprediksi: shield diangkat sebelum pukulan mendarat', async () => {
  const bot = shieldBot()
  const guard = new ShieldGuard(bot, { shield: { blockRange: 4, predictMs: 400 } }, silentLogger)
  const enemy = enemyAt(6)

  guard.start()
  guard.setTarget(enemy)
  await guard.update(enemy, 6)
  assert.equal(guard.blocking, false, 'lawan belum mengayun, shield belum diangkat')

  bot.emit('entitySwingArm', enemy)
  const raised = await guard.update(enemy, 6)

  assert.equal(raised, true, 'ayunan lawan membuat shield terangkat sebelum pukulan mendarat')
  assert.equal(guard.stats.predicted, 1)
  guard.stop()
})

test('lawan yang bergerak mendekat dianggap ancaman', async () => {
  const bot = shieldBot()
  const guard = new ShieldGuard(bot, { shield: { blockRange: 4, approachWindow: 3 } }, silentLogger)
  const enemy = enemyAt(6)
  enemy.velocity = new Vec3(-0.3, 0, 0)

  const raised = await guard.update(enemy, 6)

  assert.equal(raised, true, 'lawan mendekat cepat diprediksi akan memukul')
})

test('shield turun saat bot memukul lalu naik lagi setelah cooldown', async () => {
  const bot = shieldBot()
  const guard = new ShieldGuard(bot, { shield: { blockRange: 4 } }, silentLogger)
  const enemy = enemyAt(3)

  await guard.update(enemy, 3)
  assert.equal(guard.blocking, true)

  await guard.update(enemy, 3, { attacking: true })
  assert.equal(guard.blocking, false, 'shield turun supaya pukulan keluar')
  assert.equal(bot.deactivateCalls, 1)

  await guard.update(enemy, 3)
  assert.equal(guard.blocking, true, 'shield naik lagi di tick berikutnya')
})

test('tanpa shield di inventory bot tetap aman (tidak error)', async () => {
  const bot = shieldBot({ withShield: false })
  const guard = new ShieldGuard(bot, {}, silentLogger)

  assert.equal(findShield(bot), null)
  assert.equal(await guard.update(enemyAt(2), 2), false)
  assert.equal(bot.activateCalls.length, 0)
  assert.equal(guard.blocking, false)
})

test('shield diturunkan saat lawan keluar jangkauan dan saat stop', async () => {
  const bot = shieldBot()
  const guard = new ShieldGuard(bot, { shield: { blockRange: 4 } }, silentLogger)
  const enemy = enemyAt(3)

  await guard.update(enemy, 3)
  assert.equal(guard.blocking, true)

  await guard.update(enemyAt(20), 20)
  assert.equal(guard.blocking, false)

  await guard.update(enemy, 3)
  guard.stop()
  assert.equal(guard.blocking, false)
})
