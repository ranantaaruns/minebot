'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('events')
const Vec3 = require('vec3')
const { goals } = require('mineflayer-pathfinder')
const { PlayerHunter, findPlayer, aimPoint, arrowCount, bestBow, startHuntJob } = require('../src/safety/hunt')
const { Cancellation } = require('../src/util/async')
const { JobManager } = require('../src/jobs')
const { Cli } = require('../src/cli')

const silentLogger = {
  info () {},
  warn () {},
  debug () {},
  error () {}
}

function huntConfig (overrides = {}) {
  return {
    combat: {
      enabled: true,
      attackRange: 3.5,
      attackCooldownMs: 50,
      hunt: {
        meleeRange: 3.2,
        bowRange: 24,
        drawMs: 5,
        tickMs: 1,
        timeoutMs: 40,
        ...overrides
      }
    },
    owner: { username: 'Owner' }
  }
}

function playerEntity (position, extra = {}) {
  return {
    id: 7,
    username: 'Owner',
    name: 'player',
    type: 'player',
    position,
    velocity: new Vec3(0, 0, 0),
    height: 1.8,
    health: 20,
    isValid: true,
    ...extra
  }
}

function fakeBot (options = {}) {
  const bot = new EventEmitter()
  bot.username = options.username || 'hunter'
  bot.entity = { position: options.position || new Vec3(0, 64, 0), height: 1.8 }
  bot.health = 20
  bot.food = 20
  bot.players = {}
  bot.entities = {}
  bot.heldItem = null
  bot.inventory = { items: () => options.items || [], slots: [] }
  bot.equipCalls = []
  bot.attacks = []
  bot.looks = []
  bot.activated = 0
  bot.deactivated = 0
  bot.equip = async function (item, destination) {
    this.equipCalls.push([item.name, destination])
    this.heldItem = { type: item.type, name: item.name }
  }
  bot.lookAt = async function (point) { this.looks.push(point) }
  bot.attack = entity => {
    bot.attacks.push(entity)
    options.onAttack?.(entity, bot)
  }
  bot.activateItem = () => { bot.activated++ }
  bot.deactivateItem = () => { bot.deactivated++ }
  bot.clearControlStates = () => {}
  bot.setControlState = () => {}
  bot.pathfinder = {
    goal: null,
    goalsSet: [],
    setGoal (goal, dynamic) {
      this.goal = goal
      this.dynamic = dynamic
      this.goalsSet.push(goal)
    },
    stop () { this.goal = null }
  }
  return bot
}

function withPlayer (bot, entity, key = 'Owner') {
  bot.players[key] = { username: key, entity }
  bot.entities[entity.id] = entity
  return entity
}

const SWORD = { type: 1, name: 'wooden_sword', count: 1 }
const DIAMOND_SWORD = { type: 2, name: 'diamond_sword', count: 1 }
const BOW = { type: 3, name: 'bow', count: 1 }
const ARROW = { type: 4, name: 'arrow', count: 16 }

test('findPlayer matches usernames case-insensitively', () => {
  const bot = fakeBot()
  const entity = withPlayer(bot, playerEntity(new Vec3(0, 64, 0)), 'Owner')

  assert.equal(findPlayer(bot, 'owner').entity, entity)
  assert.equal(findPlayer(bot, 'OWNER').entity, entity)
  assert.equal(findPlayer(bot, 'Lain').entity, null)
})

test('findPlayer falls back to world entities when the player list has no entity', () => {
  const bot = fakeBot()
  const entity = playerEntity(new Vec3(3, 64, 0))
  bot.players.Owner = { username: 'Owner' }
  bot.entities[entity.id] = entity

  assert.equal(findPlayer(bot, 'Owner').entity, entity)
})

test('arrowCount and bestBow read the inventory', () => {
  const bot = fakeBot({
    items: [BOW, ARROW, { type: 9, name: 'spectral_arrow', count: 2 }, { type: 10, name: 'crossbow', count: 1 }]
  })
  assert.equal(arrowCount(bot), 18)
  assert.equal(bestBow(bot).item.name, 'bow')
  assert.equal(arrowCount(fakeBot()), 0)
  assert.equal(bestBow(fakeBot()), null)
})

test('aimPoint leads a moving target and compensates arrow drop', () => {
  const entity = playerEntity(new Vec3(0, 64, 0), { velocity: new Vec3(0.2, 0, 0) })

  const near = aimPoint(entity, 4)
  const far = aimPoint(entity, 20)

  assert.ok(far.y > near.y, 'jarak jauh butuh kompensasi jatuh lebih besar')
  assert.ok(far.x > near.x, 'target bergerak harus diarahkan di depan')
  assert.ok(near.x > 0, 'lead mengikuti arah velocity')
  assert.ok(near.y > 64 + 1, 'membidik di atas kaki target')
})

test('hunt kills a nearby player with the strongest melee weapon', async () => {
  const entity = playerEntity(new Vec3(2, 64, 0))
  const bot = fakeBot({
    items: [SWORD, DIAMOND_SWORD, BOW, ARROW],
    onAttack: () => { entity.health = 0 }
  })
  withPlayer(bot, entity)

  const hunter = new PlayerHunter(bot, huntConfig(), silentLogger)
  const result = await hunter.hunt('Owner', new Cancellation())

  assert.equal(result.killed, true)
  assert.equal(result.reason, 'killed')
  assert.ok(result.hits >= 1)
  assert.ok(bot.equipCalls.some(([name]) => name === 'diamond_sword'), 'pakai senjata terkuat')
  assert.equal(bot.attacks.length, 1)
  assert.equal(bot.activated, 0, 'jarak dekat tidak memakai bow')
})

test('hunt shoots the bow when the target is far away', async () => {
  const bot = fakeBot({ items: [SWORD, BOW, ARROW] })
  withPlayer(bot, playerEntity(new Vec3(16, 64, 0)))

  const hunter = new PlayerHunter(bot, huntConfig(), silentLogger)
  const result = await hunter.hunt('Owner', new Cancellation())

  assert.equal(result.killed, false)
  assert.equal(result.reason, 'timeout')
  assert.ok(result.shots >= 1)
  assert.ok(bot.equipCalls.some(([name, dest]) => name === 'bow' && dest === 'hand'))
  assert.equal(bot.activated, bot.deactivated, 'setiap tarikan panah harus dilepas')
  assert.equal(bot.attacks.length, 0)
  assert.ok(bot.looks[0].y > 64 + 1.5, 'membidik di atas target untuk kompensasi jatuh')
})

test('hunt approaches the target when it is beyond bow range', async () => {
  const bot = fakeBot({ items: [SWORD, BOW, ARROW] })
  withPlayer(bot, playerEntity(new Vec3(60, 64, 0)))

  const hunter = new PlayerHunter(bot, huntConfig({ timeoutMs: 30 }), silentLogger)
  const result = await hunter.hunt('Owner', new Cancellation())

  assert.ok(bot.pathfinder.goalsSet.some(goal => goal instanceof goals.GoalFollow))
  assert.equal(bot.activated, 0, 'terlalu jauh untuk memanah')
  assert.equal(result.reason, 'timeout')
})

test('hunt keeps chasing when the bow has no arrows', async () => {
  const bot = fakeBot({ items: [SWORD, BOW] })
  withPlayer(bot, playerEntity(new Vec3(12, 64, 0)))

  const hunter = new PlayerHunter(bot, huntConfig({ timeoutMs: 30 }), silentLogger)
  await hunter.hunt('Owner', new Cancellation())

  assert.ok(bot.pathfinder.goalsSet.some(goal => goal instanceof goals.GoalFollow))
  assert.equal(bot.activated, 0)
})

test('hunt reports a missing target instead of hanging', async () => {
  const bot = fakeBot()
  const hunter = new PlayerHunter(bot, huntConfig(), silentLogger)

  const result = await hunter.hunt('TidakAda', new Cancellation())
  assert.equal(result.ok, false)
  assert.equal(result.killed, false)
  assert.equal(result.reason, 'not-found')
})

test('hunt refuses to attack the bot itself', async () => {
  const bot = fakeBot()
  const hunter = new PlayerHunter(bot, huntConfig(), silentLogger)

  const result = await hunter.hunt('hunter', new Cancellation())
  assert.equal(result.reason, 'self')
})

test('hunt stops quickly when the job is cancelled', async () => {
  const bot = fakeBot({ items: [SWORD] })
  withPlayer(bot, playerEntity(new Vec3(60, 64, 0)))

  const cancellation = new Cancellation()
  const hunter = new PlayerHunter(bot, huntConfig({ timeoutMs: 5000 }), silentLogger)
  const pending = hunter.hunt('Owner', cancellation)
  setTimeout(() => cancellation.cancel('Dihentikan oleh pengguna'), 20)

  await assert.rejects(pending, err => err.cancelled === true)
})

function huntSession (bot, overrides = {}) {
  const calls = { paused: 0, resumed: 0 }
  const session = {
    bot,
    jobs: new JobManager(silentLogger),
    owner: {
      pause () { calls.paused++ },
      resume () { calls.resumed++ }
    },
    calls,
    ...overrides
  }
  return session
}

test('Cli.handleAttack menjalankan job attack dan mempause owner', async () => {
  const entity = playerEntity(new Vec3(2, 64, 0))
  const bot = fakeBot({
    items: [SWORD, DIAMOND_SWORD],
    onAttack: () => { entity.health = 0 }
  })
  withPlayer(bot, entity)

  const logs = []
  const logger = { ...silentLogger, info: msg => logs.push(msg), warn: msg => logs.push(msg) }
  const session = huntSession(bot)
  const cli = new Cli(session, huntConfig(), logger)

  const result = await cli.handleLine('attack Owner')

  assert.equal(result.killed, true)
  assert.equal(session.calls.paused, 1)
  assert.equal(session.calls.resumed, 1)
  assert.equal(session.jobs.busy, false)
  assert.ok(logs.some(msg => /Target Owner mati/.test(msg)))
})

test('Cli.handleAttack menolak perintah tanpa nama player', async () => {
  const bot = fakeBot()
  const cli = new Cli(huntSession(bot), huntConfig(), silentLogger)

  await assert.rejects(cli.handleAttack([]), /Gunakan: attack <nama player>/)
})

test('Cli.handleAttack menyebut player yang tersedia saat target tidak dikenal', async () => {
  const bot = fakeBot()
  withPlayer(bot, playerEntity(new Vec3(0, 64, 0)), 'Alice')
  const cli = new Cli(huntSession(bot), huntConfig(), silentLogger)

  await assert.rejects(cli.handleAttack(['Bob']), /Player "Bob" tidak ditemukan.*Alice/)
})

test('startHuntJob menolak kalau masih ada job lain', async () => {
  const bot = fakeBot()
  withPlayer(bot, playerEntity(new Vec3(2, 64, 0)))
  const session = huntSession(bot)

  const running = session.jobs.run('gather', () => new Promise(resolve => setTimeout(resolve, 30)))
  await assert.rejects(startHuntJob(session, 'Owner'), /Masih ada job/)
  await running
})
