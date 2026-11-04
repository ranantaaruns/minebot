'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('events')
const Vec3 = require('vec3')
const { PlayerHunter } = require('../src/safety/hunt')

const silentLogger = { info () {}, warn () {}, debug () {}, error () {} }

const SWORD = { name: 'diamond_sword', type: 276, count: 1 }

function huntConfig (overrides = {}) {
  return {
    combat: {
      attackCooldownMs: 120,
      hunt: {
        meleeRange: 3.2,
        bowRange: 0,
        tickMs: 1,
        timeoutMs: 400,
        critTickMs: 3,
        ...overrides
      }
    }
  }
}

// Bot dengan physics sederhana supaya critical hit (memukul saat jatuh) bisa diuji.
function critPvpBot ({ position = new Vec3(0, 64, 0) } = {}) {
  const bot = new EventEmitter()
  bot.username = 'hunter'
  bot.entity = {
    position,
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
  bot.inventory = { items: () => [SWORD], slots: [] }
  bot.attacks = []
  bot.equip = async function (item) { this.heldItem = { type: item.type, name: item.name } }
  bot.attack = entity => {
    bot.attacks.push({
      id: entity.id,
      velocityY: bot.entity.velocity.y,
      onGround: bot.entity.onGround
    })
  }
  bot.lookAt = async () => {}
  bot.activateItem = () => {}
  bot.deactivateItem = () => {}
  bot.clearControlStates = () => {}
  bot.setControlState = function (name, state) {
    this.controlState[name] = state
    if (name === 'jump' && state && this.entity.onGround) {
      this.entity.velocity = new Vec3(0, 0.42, 0)
      this.entity.onGround = false
    }
  }
  bot.blockAt = () => ({ name: 'air', boundingBox: 'empty' })
  bot.pathfinder = { stop () {}, setGoal () {}, async goto () {} }

  const gravity = setInterval(() => {
    if (bot.entity.onGround) return
    const vy = bot.entity.velocity.y - 0.08
    bot.entity.velocity = new Vec3(0, vy, 0)
    const y = bot.entity.position.y + vy
    if (y <= 64) {
      bot.entity.position = new Vec3(bot.entity.position.x, 64, bot.entity.position.z)
      bot.entity.velocity = new Vec3(0, 0, 0)
      bot.entity.onGround = true
    } else {
      bot.entity.position = new Vec3(bot.entity.position.x, y, bot.entity.position.z)
    }
  }, 4)
  gravity.unref?.()
  bot.stopPhysics = () => clearInterval(gravity)

  return bot
}

function withTarget (bot, position = new Vec3(1.8, 64, 0)) {
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
  return entity
}

test('PvP: bot memukul saat jatuh sehingga damage-nya critical', async () => {
  const bot = critPvpBot()
  withTarget(bot)

  const hunter = new PlayerHunter(bot, huntConfig(), silentLogger)
  const result = await hunter.hunt('Enemy')

  assert.ok(result.hits >= 1, 'bot memukul')
  assert.ok(result.crits >= 1, 'minimal satu pukulan kritikal')
  const crit = bot.attacks.find(attack => attack.onGround === false && attack.velocityY < 0)
  assert.ok(crit, 'pukulan mendarat saat bot jatuh (velocity.y negatif)')
  bot.stopPhysics()
})

test('PvP: crit bisa dimatikan lewat config', async () => {
  const bot = critPvpBot()
  withTarget(bot)

  const hunter = new PlayerHunter(bot, huntConfig({ critEnabled: false }), silentLogger)
  const result = await hunter.hunt('Enemy')

  assert.ok(result.hits >= 1)
  assert.equal(result.crits, 0)
  assert.equal(bot.attacks.every(attack => attack.onGround === true), true, 'pukulan dari tanah')
  bot.stopPhysics()
})

test('PvP: bot di air tidak memaksakan crit (crit tidak sah di air)', async () => {
  const bot = critPvpBot()
  bot.entity.isInWater = true
  withTarget(bot)

  const hunter = new PlayerHunter(bot, huntConfig(), silentLogger)
  const result = await hunter.hunt('Enemy')

  assert.ok(result.hits >= 1)
  assert.equal(result.crits, 0)
  bot.stopPhysics()
})
