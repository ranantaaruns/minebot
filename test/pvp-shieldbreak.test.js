'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('events')
const Vec3 = require('vec3')
const { PlayerHunter } = require('../src/safety/hunt')

const logs = []
const logger = {
  info: message => logs.push(message),
  warn: message => logs.push(message),
  debug: () => {},
  error: () => {}
}

const SWORD = { name: 'diamond_sword', type: 276, count: 1 }
const AXE = { name: 'diamond_axe', type: 279, count: 1 }

function huntConfig (overrides = {}) {
  return {
    combat: {
      attackCooldownMs: 60,
      hunt: {
        meleeRange: 3.2,
        bowRange: 0,
        tickMs: 1,
        timeoutMs: 700,
        critEnabled: false,
        ...overrides
      }
    }
  }
}

// Lawan yang memblok dengan shield: pukulan pedang tidak mengurangi darahnya,
// pukulan kapak mematikan shield-nya selama 5 detik.
function shieldFightBot ({ items = [SWORD, AXE], enemyHealth = 200 } = {}) {
  const bot = new EventEmitter()
  bot.username = 'hunter'
  bot.entity = {
    position: new Vec3(0, 64, 0),
    velocity: new Vec3(0, 0, 0),
    onGround: true,
    height: 1.8,
    id: 1
  }
  bot.controlState = {}
  bot.health = 20
  bot.food = 20
  bot.heldItem = null
  bot.players = {}
  bot.entities = {}
  bot.inventory = { items: () => items, slots: [] }
  bot.equips = []
  bot.swings = []

  bot.equip = async function (item) {
    this.equips.push(item.name)
    this.heldItem = { type: item.type, name: item.name }
  }
  bot.attack = entity => {
    const weapon = bot.heldItem?.name || 'hand'
    bot.swings.push(weapon)
    if (entity.blocking) {
      if (weapon.endsWith('_axe')) {
        entity.blocking = false
        entity.shieldOffUntil = Date.now() + 5000
      }
      return // shield menahan pukulan
    }
    entity.health -= 6
  }
  bot.lookAt = async () => {}
  bot.activateItem = () => {}
  bot.deactivateItem = () => {}
  bot.clearControlStates = () => {}
  bot.setControlState = () => {}
  bot.blockAt = () => ({ name: 'air', boundingBox: 'empty' })
  bot.pathfinder = { stop () {}, setGoal () {}, async goto () {} }

  const entity = {
    id: 7,
    username: 'Enemy',
    name: 'player',
    type: 'player',
    position: new Vec3(1.8, 64, 0),
    velocity: new Vec3(0, 0, 0),
    height: 1.8,
    health: enemyHealth,
    heldItem: { name: 'shield', type: 442, count: 1 },
    blocking: true
  }
  bot.players.Enemy = { username: 'Enemy', entity }
  bot.entities[entity.id] = entity
  bot.enemy = entity
  return bot
}

test('PvP: lawan memblok pakai shield -> bot pukul pakai kapak lalu lanjut pedang', async () => {
  logs.length = 0
  const bot = shieldFightBot()
  const hunter = new PlayerHunter(bot, huntConfig(), logger)
  const result = await hunter.hunt('Enemy')

  assert.deepEqual(bot.swings.slice(0, 3), ['diamond_sword', 'diamond_axe', 'diamond_sword'],
    'pedang (tertahan) -> kapak (mematahkan) -> pedang lagi')
  assert.equal(result.breaks, 1, 'satu kali shield musuh dipatahkan')
  assert.ok(bot.enemy.health < 200, 'setelah shield cooldown, pedang melukai lawan')
  assert.ok(logs.some(line => /kapak/i.test(line)), 'aktivitas kapak dilaporkan')
})

test('PvP: tanpa kapak di inventory bot tetap menyerang dengan pedang', async () => {
  logs.length = 0
  const bot = shieldFightBot({ items: [SWORD] })
  const hunter = new PlayerHunter(bot, huntConfig(), logger)
  const result = await hunter.hunt('Enemy')

  assert.equal(result.breaks, 0)
  assert.equal(bot.equips.every(name => name === 'diamond_sword'), true, 'tidak memasang kapak')
  assert.ok(result.hits >= 1, 'tetap menyerang')
  assert.ok(logs.some(line => /tidak ada kapak/i.test(line)))
})

test('PvP: kalau lawan tidak memblok, bot tetap pakai pedang (tidak buang waktu ganti kapak)', async () => {
  logs.length = 0
  const bot = shieldFightBot()
  bot.enemy.blocking = false

  const hunter = new PlayerHunter(bot, huntConfig(), logger)
  const result = await hunter.hunt('Enemy')

  assert.equal(result.breaks, 0)
  assert.equal(bot.swings.every(name => name === 'diamond_sword'), true)
})
