'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('events')
const Vec3 = require('vec3')
const { PlayerHunter } = require('../src/safety/hunt')
const { sleep } = require('../src/util/async')

const silentLogger = { info () {}, warn () {}, debug () {}, error () {} }

const SWORD = { name: 'diamond_sword', type: 276, count: 1 }
const SHIELD = { name: 'shield', type: 442, count: 1 }

function huntConfig (overrides = {}) {
  return {
    combat: {
      attackCooldownMs: 30,
      hunt: {
        meleeRange: 3.2,
        bowRange: 24,
        drawMs: 5,
        tickMs: 1,
        timeoutMs: 60,
        ...overrides
      }
    },
    owner: { username: 'Owner' }
  }
}

function shieldPvpBot ({ position = new Vec3(0, 64, 0), items = [SWORD, SHIELD] } = {}) {
  const bot = new EventEmitter()
  bot.username = 'hunter'
  bot.entity = { position, height: 1.8, id: 1 }
  bot.health = 20
  bot.food = 20
  bot.players = {}
  bot.entities = {}
  bot.heldItem = null
  bot.inventory = { items: () => items, slots: [] }
  bot.actions = []
  bot.equip = async function (item, destination) {
    bot.actions.push(['equip', item.name, destination])
    if (destination === 'off-hand') bot.inventory.slots[45] = item
    else bot.heldItem = { type: item.type, name: item.name }
  }
  bot.activateItem = offHand => { bot.actions.push(['activate', Boolean(offHand)]) }
  bot.deactivateItem = () => { bot.actions.push(['deactivate']) }
  bot.lookAt = async () => {}
  bot.attack = entity => { bot.actions.push(['attack', entity.id]) }
  bot.clearControlStates = () => {}
  bot.pathfinder = { stop () {}, setGoal () {}, async goto () {} }
  return bot
}

function withTarget (bot, position, distance) {
  const entity = {
    id: 7,
    username: 'Enemy',
    name: 'player',
    type: 'player',
    position,
    velocity: new Vec3(0, 0, 0),
    height: 1.8,
    health: 20
  }
  bot.players.Enemy = { username: 'Enemy', entity }
  bot.entities[entity.id] = entity
  entity.distance = distance
  return entity
}

const offHandShield = bot => bot.actions.some(([kind, name, dest]) => kind === 'equip' && name === 'shield' && dest === 'off-hand')
const raised = bot => bot.actions.filter(([kind, off]) => kind === 'activate' && off === true).length

test('PvP: shield dipasang di off-hand dan diangkat saat lawan dalam jangkauan', async () => {
  const bot = shieldPvpBot()
  withTarget(bot, new Vec3(2, 64, 0))

  const hunter = new PlayerHunter(bot, huntConfig(), silentLogger)
  await hunter.hunt('Enemy')

  assert.equal(offHandShield(bot), true, 'shield harus dipasang di off-hand')
  assert.ok(raised(bot) >= 1, 'shield diangkat saat lawan dekat')
  assert.ok(bot.actions.some(([kind]) => kind === 'attack'), 'bot tetap menyerang')
})

test('PvP: shield tetap terangkat saat memukul (block tidak putus)', async () => {
  const bot = shieldPvpBot()
  withTarget(bot, new Vec3(2, 64, 0))

  const hunter = new PlayerHunter(bot, huntConfig(), silentLogger)
  await hunter.hunt('Enemy')

  const kinds = bot.actions.map(([kind]) => kind)
  const firstRaise = kinds.indexOf('activate')
  const firstAttack = kinds.indexOf('attack')
  const deactivateBeforeAttack = kinds.slice(0, firstAttack).includes('deactivate')

  assert.ok(firstRaise >= 0 && firstAttack > firstRaise, 'shield naik sebelum pukulan')
  assert.equal(deactivateBeforeAttack, false, 'shield tidak diturunkan untuk memukul')
  assert.ok(kinds.filter(kind => kind === 'attack').length >= 1)
})

test('PvP: ayunan lawan dari jarak 2 blok di luar jangkauan tetap memicu block', async () => {
  const bot = shieldPvpBot()
  const enemy = withTarget(bot, new Vec3(5, 64, 0))

  const hunter = new PlayerHunter(bot, huntConfig({ meleeRange: 3.2, bowRange: 24 }), silentLogger)
  const job = hunter.hunt('Enemy')
  // Ayunan lawan = sinyal serangan; bot harus mengangkat shield sebelum damage masuk.
  await sleep(20)
  bot.emit('entitySwingArm', enemy)
  await job

  assert.ok(raised(bot) >= 1, 'prediksi ayunan membuat shield terangkat')
  assert.equal(offHandShield(bot), true)
})

test('PvP: tanpa shield di inventory bot tetap menyerang', async () => {
  const bot = shieldPvpBot({ items: [SWORD] })
  withTarget(bot, new Vec3(2, 64, 0))

  const hunter = new PlayerHunter(bot, huntConfig(), silentLogger)
  const result = await hunter.hunt('Enemy')

  assert.ok(result.hits >= 1)
  assert.equal(bot.actions.some(([kind]) => kind === 'activate'), false)
})
