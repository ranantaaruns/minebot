'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('events')
const Vec3 = require('vec3')
const { PlayerHunter } = require('../src/safety/hunt')

const silentLogger = { info () {}, warn () {}, debug () {}, error () {} }

const SWORD = { type: 1, name: 'diamond_sword', count: 1 }
const BREAD = { type: 2, name: 'bread', count: 4 }

function huntConfig (overrides = {}) {
  return {
    combat: {
      attackCooldownMs: 20,
      hunt: {
        meleeRange: 3.2,
        bowRange: 0,
        drawMs: 5,
        tickMs: 1,
        timeoutMs: 900,
        retreatHealth: 10,
        retreatResumeHealth: 16,
        retreatDistance: 4,
        retreatRadius: 8,
        retreatHealTimeoutMs: 2000,
        ...overrides
      }
    }
  }
}

// Dunia datar: semua blok padat di bawah y=64, kosong di atasnya.
function retreatBot ({ health = 8, food = 12, position = new Vec3(0, 64, 0) } = {}) {
  const bot = new EventEmitter()
  bot.username = 'hunter'
  bot.entity = { position, height: 1.8 }
  bot.health = health
  bot.food = food
  bot.heldItem = null
  bot.inventory = { items: () => [SWORD, BREAD], slots: [] }
  bot.players = {}
  bot.entities = {}
  bot.attacks = []
  bot.consumes = 0
  bot.equips = []
  bot.blockAt = pos => {
    if (pos.y < 64) return { name: 'stone', boundingBox: 'block', diggable: true }
    return { name: 'air', boundingBox: 'empty' }
  }
  bot.equip = async function (item) {
    this.equips.push(item.name)
    this.heldItem = { type: item.type, name: item.name }
  }
  bot.consume = async function () {
    this.consumes++
    this.food = 20
    // makan memicu regen: setelah makan, darah pulih sampai ambang lanjut
    this.health = 16
  }
  bot.lookAt = async () => {}
  bot.attack = entity => { bot.attacks.push(entity) }
  bot.activateItem = () => {}
  bot.deactivateItem = () => {}
  bot.clearControlStates = () => {}
  bot.setControlState = () => {}
  bot.foodManager = {
    pickFood: () => (bot.food >= 20 ? null : { item: BREAD })
  }
  bot.pathfinder = {
    goals: [],
    gotoCalls: 0,
    setGoal (goal) {
      this.goals.push(goal)
      // simulasi pathfinder mendekat: bot berhenti 1 blok dari target
      const target = bot.entities[7]
      if (target) bot.entity.position = new Vec3(target.position.x - 1, 64, target.position.z)
    },
    stop () {},
    async goto (goal) {
      this.gotoCalls++
      this.goals.push(goal)
      const p = goal?.position?.()
      if (p) bot.entity.position = new Vec3(p.x, p.y, p.z)
    }
  }
  return bot
}

function withTarget (bot, position = new Vec3(1.5, 64, 0), health = 20) {
  const entity = {
    id: 7,
    username: 'Enemy',
    name: 'player',
    type: 'player',
    position,
    velocity: new Vec3(0, 0, 0),
    height: 1.8,
    health
  }
  bot.players.Enemy = { username: 'Enemy', entity }
  bot.entities[entity.id] = entity
  return entity
}

test('bot mundur dan heal saat darah rendah lalu lanjut menyerang', async () => {
  const logs = []
  const logger = { ...silentLogger, warn: m => logs.push(m), info: m => logs.push(m) }
  const bot = retreatBot({ health: 8 })
  const target = withTarget(bot)

  const hunter = new PlayerHunter(bot, huntConfig(), logger)
  const result = await hunter.hunt('Enemy')

  assert.equal(result.retreats, 1, 'harus retreat satu kali')
  assert.equal(bot.pathfinder.gotoCalls, 1, 'bot berjalan ke tempat aman')
  assert.equal(bot.consumes, 1, 'bot makan untuk heal')
  assert.ok(bot.attacks.length >= 1, 'setelah pulih bot lanjut menyerang')
  assert.equal(bot.health, 16)
  assert.ok(logs.some(m => /mundur/i.test(m)))
  assert.ok(logs.some(m => /lanjut menyerang/i.test(m)))

  const spot = bot.pathfinder.goals[0]
  const away = Math.hypot(spot.x - target.position.x, spot.z - target.position.z)
  assert.ok(away >= 4, 'tempat aman minimal retreatDistance dari target')
})

test('bot tidak mundur bila darah masih aman', async () => {
  const bot = retreatBot({ health: 20, food: 20 })
  withTarget(bot)

  const hunter = new PlayerHunter(bot, huntConfig(), silentLogger)
  const result = await hunter.hunt('Enemy')

  assert.equal(result.retreats, 0)
  assert.equal(bot.pathfinder.gotoCalls, 0)
  assert.equal(bot.consumes, 0)
  assert.ok(bot.attacks.length >= 1)
})

test('bot tetap mundur walau tidak punya makanan', async () => {
  const bot = retreatBot({ health: 8 })
  bot.foodManager.pickFood = () => null
  withTarget(bot)

  const hunter = new PlayerHunter(bot, huntConfig({ timeoutMs: 1200, retreatHealTimeoutMs: 300 }), silentLogger)
  const result = await hunter.hunt('Enemy')

  assert.equal(result.retreats, 1)
  assert.equal(bot.consumes, 0)
  assert.equal(bot.attacks.length, 0, 'tidak menyerang saat masih sekarat')
  assert.equal(result.reason, 'timeout')
})

test('retreat bisa dimatikan lewat config', async () => {
  const bot = retreatBot({ health: 4 })
  withTarget(bot)

  const hunter = new PlayerHunter(bot, huntConfig({ retreatEnabled: false }), silentLogger)
  const result = await hunter.hunt('Enemy')

  assert.equal(result.retreats, 0)
  assert.equal(bot.pathfinder.gotoCalls, 0)
})
