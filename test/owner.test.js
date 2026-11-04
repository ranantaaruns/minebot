'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('events')
const Vec3 = require('vec3')
const { goals } = require('mineflayer-pathfinder')
const { OwnerTracker, isStuck } = require('../src/owner')

const silentLogger = {
  info () {},
  warn () {},
  error () {},
  debug () {}
}

function ownerConfig (overrides = {}) {
  return {
    username: 'Owner',
    autoFollow: true,
    followDistance: 3,
    stuckTimeoutMs: 4000,
    maxStuckRetries: 2,
    stuckCooldownMs: 10000,
    unstickJump: true,
    askCoords: false,
    askCoordsIntervalMs: 60000,
    allowTower: true,
    towerGather: {
      enabled: true,
      minGap: 2,
      maxAttempts: 3,
      cooldownMs: 30000
    },
    ...overrides
  }
}

function fakeBot (position = new Vec3(0, 64, 0)) {
  const bot = new EventEmitter()
  const goalsSet = []
  const controls = []
  bot.entity = { position, onGround: true }
  bot.players = {}
  bot.entities = {}
  bot.pathfinder = {
    goal: null,
    goalsSet,
    setGoal (goal) {
      this.goal = goal
      goalsSet.push(goal)
    },
    stop () {
      this.goal = null
    },
    async goto () {}
  }
  bot.clearControlStates = () => {}
  bot.setControlState = (name, state) => controls.push([name, state])
  bot.whisper = () => {}
  bot.controls = controls
  return bot
}

test('owner tick sets a follow goal when the owner is far away', async t => {
  const bot = fakeBot()
  const ownerEntity = { position: new Vec3(10, 64, 0) }
  bot.players.Owner = { entity: ownerEntity }
  const owner = new OwnerTracker(bot, ownerConfig(), silentLogger)
  t.after(() => owner.stop())

  await owner.tick()

  assert.ok(bot.pathfinder.goal instanceof goals.GoalNear)
  assert.equal(bot.pathfinder.goal.x, 10)
  assert.equal(bot.pathfinder.goal.y, 64)
  assert.equal(bot.pathfinder.goal.z, 0)
})

test('owner pause cancels the active follow goal', t => {
  const bot = fakeBot()
  const owner = new OwnerTracker(bot, ownerConfig(), silentLogger)
  t.after(() => owner.stop())
  bot.pathfinder.goal = new goals.GoalNear(10, 64, 0, 3)

  owner.pause()

  assert.equal(owner.paused, true)
  assert.equal(bot.pathfinder.goal, null)
  assert.ok(bot.pathfinder.goalsSet.includes(null))
})

test('owner gathers tower blocks after pathfinder reports no path', async t => {
  const bot = fakeBot()
  const ownerEntity = { position: new Vec3(10, 72, 0) }
  bot.players.Owner = { entity: ownerEntity }
  const calls = []
  const towerSupply = {
    async ensure (point) {
      calls.push(point.clone())
      return { ok: true, gathered: 8, have: 8 }
    }
  }
  const owner = new OwnerTracker(bot, ownerConfig(), silentLogger, { towerSupply })
  t.after(() => owner.stop())

  await owner.tick()
  bot.emit('path_update', { status: 'noPath', path: [] })
  await new Promise(resolve => setImmediate(resolve))
  await new Promise(resolve => setImmediate(resolve))

  assert.equal(calls.length, 1)
  assert.equal(calls[0].y, 72)
  assert.ok(bot.pathfinder.goal instanceof goals.GoalNear)
})

test('isStuck detects no movement after the timeout only', () => {
  const last = new Vec3(0, 64, 0)
  const still = new Vec3(0.1, 64, 0)
  const moved = new Vec3(0.5, 64, 0)

  assert.equal(isStuck(still, last, 1000, 3000, 4000), false)
  assert.equal(isStuck(still, last, 1000, 5000, 4000), true)
  assert.equal(isStuck(moved, last, 1000, 5000, 4000), false)
})

test('owner tries a water approach before tower supply when there is no path', async t => {
  const bot = fakeBot()
  bot.players.Owner = { entity: { position: new Vec3(10, 64, 0) } }
  const calls = []
  const waterNavigator = {
    busy: false,
    canApproach: point => point.x === 10,
    async approach (point) {
      calls.push(point.clone())
      return true
    }
  }
  const towerSupply = {
    async ensure () {
      calls.push('tower')
      return { ok: true, gathered: 8 }
    }
  }
  const owner = new OwnerTracker(bot, ownerConfig(), silentLogger, { towerSupply, waterNavigator })
  t.after(() => owner.stop())

  await owner.tick()
  bot.emit('path_update', { status: 'noPath', path: [] })
  await new Promise(resolve => setImmediate(resolve))
  await new Promise(resolve => setImmediate(resolve))

  assert.equal(calls.length, 1)
  assert.equal(calls[0].x, 10)
})

test('owner falls back to tower supply when water approach is not possible', async t => {
  const bot = fakeBot()
  bot.players.Owner = { entity: { position: new Vec3(10, 72, 0) } }
  let approached = 0
  let towers = 0
  const waterNavigator = {
    busy: false,
    canApproach: () => false,
    async approach () { approached++; return true }
  }
  const towerSupply = {
    async ensure () { towers++; return { ok: true, gathered: 8 } }
  }
  const owner = new OwnerTracker(bot, ownerConfig(), silentLogger, { towerSupply, waterNavigator })
  t.after(() => owner.stop())

  await owner.tick()
  bot.emit('path_update', { status: 'noPath', path: [] })
  await new Promise(resolve => setImmediate(resolve))
  await new Promise(resolve => setImmediate(resolve))
  await new Promise(resolve => setImmediate(resolve))

  assert.equal(approached, 0)
  assert.equal(towers, 1)
})

test('owner food hold cancels and restores following', t => {
  const bot = fakeBot()
  bot.players.Owner = { entity: { position: new Vec3(10, 64, 0) } }
  const owner = new OwnerTracker(bot, ownerConfig(), silentLogger)
  t.after(() => owner.stop())

  owner.holdForFood()
  assert.equal(owner.foodPaused, true)
  assert.equal(bot.pathfinder.goal, null)

  owner.releaseFoodHold()
  assert.equal(owner.foodPaused, false)
  assert.ok(bot.pathfinder.goal instanceof goals.GoalNear)
})

test('owner goto retries when tower blocks are already available', async t => {
  const bot = fakeBot()
  let attempts = 0
  bot.pathfinder.goto = async () => {
    attempts++
    if (attempts === 1) {
      const err = new Error('no path')
      err.name = 'NoPath'
      throw err
    }
  }
  let ensured = 0
  const towerSupply = {
    async ensure () {
      ensured++
      return { ok: true, gathered: 0, have: 8 }
    }
  }
  const owner = new OwnerTracker(bot, ownerConfig(), silentLogger, { towerSupply })
  t.after(() => owner.stop())

  const result = await owner._goto(new Vec3(10, 72, 0), 2)

  assert.equal(result, true)
  assert.equal(ensured, 1)
  assert.equal(attempts, 2)
})

test('owner water entry does not cancel an active job path while paused', t => {
  const bot = fakeBot()
  const owner = new OwnerTracker(bot, ownerConfig(), silentLogger)
  t.after(() => owner.stop())

  owner.pause()
  const goal = new goals.GoalNear(10, 64, 0, 3)
  bot.pathfinder.goal = goal

  owner.onWaterEnter()

  assert.equal(bot.pathfinder.goal, goal)
})
