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
        timeoutMs: 600,
        retreatHealth: 10,
        retreatResumeHealth: 16,
        retreatDistance: 4,
        retreatTickMs: 1,
        retreatFleeTimeoutMs: 300,
        retreatZigzagDeg: 40,
        retreatZigzagMs: 8,
        ...overrides
      }
    }
  }
}

// Dunia datar: blok padat di bawah y=64, kosong di atasnya. Bot bergerak ke arah
// hasil lookAt setiap kali kontrol `forward` dinyalakan, meniru physics.
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
  bot.controls = []
  bot.headings = []
  bot.direction = { x: -1, z: 0 }
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
    // makan butuh waktu: bot harus tetap lari selama proses ini
    await new Promise(resolve => setTimeout(resolve, 25))
    this.food = 20
    // makan memicu regen: setelah makan, darah pulih sampai ambang lanjut
    this.health = 16
  }
  bot.lookAt = async function (point) {
    const dx = point.x - this.entity.position.x
    const dz = point.z - this.entity.position.z
    const length = Math.hypot(dx, dz) || 1
    this.direction = { x: dx / length, z: dz / length }
    this.headings.push(this.direction)
  }
  bot.attack = entity => { bot.attacks.push(entity) }
  bot.activateItem = () => {}
  bot.deactivateItem = () => {}
  bot.clearControlStates = function () { this.controls.push(['clear', true]) }
  bot.setControlState = function (name, state) {
    this.controls.push([name, state])
    if (name === 'forward' && state) {
      this.entity.position = new Vec3(
        this.entity.position.x + this.direction.x * 0.3,
        this.entity.position.y,
        this.entity.position.z + this.direction.z * 0.3
      )
    }
  }
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

function forwardTicks (bot) {
  return bot.controls.filter(([name, state]) => name === 'forward' && state === true).length
}

test('bot lari menjauh sambil makan saat darah rendah lalu lanjut menyerang', async () => {
  const logs = []
  const logger = { ...silentLogger, warn: m => logs.push(m), info: m => logs.push(m) }
  const bot = retreatBot({ health: 8 })
  const target = withTarget(bot)
  const startDistance = bot.entity.position.distanceTo(target.position)

  const hunter = new PlayerHunter(bot, huntConfig(), logger)
  const result = await hunter.hunt('Enemy')

  const lastPosition = bot.entity.position
  const fledDistance = Math.hypot(
    lastPosition.x - target.position.x,
    lastPosition.z - target.position.z
  )

  assert.equal(result.retreats, 1, 'harus retreat satu kali')
  assert.ok(forwardTicks(bot) >= 2, 'bot berlari (kontrol forward aktif)')
  assert.equal(bot.pathfinder.gotoCalls, 0, 'lari tidak memakai pathfinder (tidak bisa "Path was stopped")')
  assert.equal(bot.consumes, 1, 'bot makan untuk heal sambil lari')
  assert.ok(bot.attacks.length >= 1, 'setelah pulih bot lanjut menyerang')
  assert.equal(bot.health, 16)
  assert.ok(logs.some(m => /lari/i.test(m)))
  assert.ok(logs.some(m => /lanjut menyerang/i.test(m)))
  assert.ok(bot.headings.length >= 2, 'bot beberapa kali mengubah arah lari')
  assert.ok(fledDistance >= startDistance, 'jarak ke target tidak menyusut saat lari')
})

test('arah lari berbelok-belok, bukan lurus ke satu arah', async () => {
  const bot = retreatBot({ health: 8 })
  bot.foodManager.pickFood = () => null
  withTarget(bot)

  const hunter = new PlayerHunter(bot, huntConfig({ retreatFleeTimeoutMs: 60 }), silentLogger)
  await hunter.hunt('Enemy')

  const straight = { x: bot.headings[0].x, z: bot.headings[0].z }
  const sides = new Set()
  for (const heading of bot.headings) {
    const cross = straight.x * heading.z - straight.z * heading.x
    if (Math.abs(cross) > 0.05) sides.add(Math.sign(cross))
  }
  assert.deepEqual([...sides].sort(), [-1, 1], 'heading lari harus berganti sisi')
})

test('bot tidak mundur bila darah masih aman', async () => {
  const bot = retreatBot({ health: 20, food: 20 })
  withTarget(bot)

  const hunter = new PlayerHunter(bot, huntConfig(), silentLogger)
  const result = await hunter.hunt('Enemy')

  assert.equal(result.retreats, 0)
  assert.equal(forwardTicks(bot), 0)
  assert.equal(bot.pathfinder.gotoCalls, 0)
  assert.equal(bot.consumes, 0)
  assert.ok(bot.attacks.length >= 1)
})

test('bot tetap lari walau tidak punya makanan', async () => {
  const bot = retreatBot({ health: 8 })
  bot.foodManager.pickFood = () => null
  withTarget(bot)

  const hunter = new PlayerHunter(bot, huntConfig({ timeoutMs: 500, retreatFleeTimeoutMs: 100 }), silentLogger)
  const result = await hunter.hunt('Enemy')

  assert.equal(result.retreats, 1)
  assert.equal(bot.consumes, 0)
  assert.ok(forwardTicks(bot) >= 2, 'tetap menjauh walau tidak bisa heal')
  assert.equal(bot.attacks.length, 0, 'tidak menyerang saat masih sekarat')
  assert.equal(result.reason, 'timeout')
})

test('retreat bisa dimatikan lewat config', async () => {
  const bot = retreatBot({ health: 4 })
  withTarget(bot)

  const hunter = new PlayerHunter(bot, huntConfig({ retreatEnabled: false }), silentLogger)
  const result = await hunter.hunt('Enemy')

  assert.equal(result.retreats, 0)
  assert.equal(forwardTicks(bot), 0)
  assert.equal(bot.pathfinder.gotoCalls, 0)
})
