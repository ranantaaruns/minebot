'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('events')
const Vec3 = require('vec3')
const mcData = require('minecraft-data')('1.21.4')
const { FoodManager, pickFood } = require('../src/safety/food')

const silentLogger = {
  info () {},
  warn () {},
  debug () {},
  error () {}
}

function item (name, count = 1) {
  return { type: mcData.itemsByName[name].id, name, count }
}

function foodConfig (overrides = {}) {
  return {
    owner: { username: 'Owner' },
    safety: {
      autoEat: true,
      eatThreshold: 16,
      criticalFood: 6,
      eatCheckIntervalMs: 60000,
      eatRetryMs: 4000,
      noFoodAction: 'stop',
      pauseMovementWhileEating: true,
      ...overrides
    }
  }
}

function fakeBot (options = {}) {
  const bot = new EventEmitter()
  bot.version = '1.21.4'
  bot.entity = { position: new Vec3(0, 64, 0), isInWater: false }
  bot.isAlive = true
  bot.food = options.food ?? 20
  bot.inventory = {
    items: () => options.items || []
  }
  bot.usingHeldItem = false
  bot.currentWindow = null
  bot.targetDigBlock = null
  bot.autoEating = false
  bot.consumed = 0
  bot.whispers = []
  bot.equip = async equipped => { bot.equipped = equipped }
  bot.consume = async () => {
    if (options.consumeError) throw new Error(options.consumeError)
    bot.consumed++
    bot.food = options.foodAfterEat ?? 20
  }
  bot.whisper = (username, message) => { bot.whispers.push({ username, message }) }
  bot.pathfinder = {
    isBuilding: () => false,
    isMining: () => false
  }
  bot.setControlState = () => {}
  return bot
}

function fakeOwner () {
  return {
    held: 0,
    released: 0,
    holdForFood () { this.held++ },
    releaseFoodHold () { this.released++ }
  }
}

function fakeWater () {
  return {
    states: [],
    setPaused (value) { this.states.push(value) }
  }
}

test('food manager eats when food is low and resumes movement', async t => {
  const bot = fakeBot({ food: 10, items: [item('bread', 3)] })
  const owner = fakeOwner()
  const water = fakeWater()
  const manager = new FoodManager(bot, foodConfig(), silentLogger)
  manager.attach(owner, water)
  manager.start()
  t.after(() => manager.stop())

  await manager.check()

  assert.equal(bot.consumed, 1)
  assert.equal(bot.equipped.name, 'bread')
  assert.equal(owner.held, 1)
  assert.equal(owner.released, 1)
  assert.equal(water.states[0], true)
  assert.equal(water.states[water.states.length - 1], false)
})

test('food manager waits for an active dig before equipping food', async t => {
  const bot = fakeBot({ food: 10, items: [item('bread', 3)] })
  const manager = new FoodManager(bot, foodConfig(), silentLogger)
  manager.start()
  t.after(() => manager.stop())

  bot.targetDigBlock = { position: new Vec3(0, 64, 0) }
  await manager.check()
  assert.equal(manager.pending, true)
  assert.equal(bot.consumed, 0)

  bot.targetDigBlock = null
  await manager.check()
  assert.equal(bot.consumed, 1)
})

test('food manager stops and asks the owner when food is critical', async t => {
  const bot = fakeBot({ food: 5, items: [] })
  const owner = fakeOwner()
  const water = fakeWater()
  const starved = []
  const manager = new FoodManager(bot, foodConfig(), silentLogger, {
    onStarving: food => starved.push(food)
  })
  manager.attach(owner, water)
  manager.start()
  t.after(() => manager.stop())

  await manager.check()

  assert.equal(manager.waitingForFood, true)
  assert.equal(owner.held, 1)
  assert.equal(water.states.at(-1), true)
  assert.equal(bot.whispers.length, 1)
  assert.match(bot.whispers[0].message, /kehabisan makanan/)
  assert.deepEqual(starved, [5])
  assert.equal(await manager.waitUntilReady(), false)
})

test('food manager manual resume refuses while critical without food', async t => {
  const bot = fakeBot({ food: 5, items: [] })
  const owner = fakeOwner()
  const manager = new FoodManager(bot, foodConfig(), silentLogger)
  manager.attach(owner)
  manager.start()
  t.after(() => manager.stop())

  await manager.check()
  const resumed = manager.manualResume()

  assert.equal(resumed, false)
  assert.equal(manager.waitingForFood, true)
  assert.equal(owner.released, 0)
})

test('food manager manual resume works when food is above critical', async t => {
  const bot = fakeBot({ food: 5, items: [] })
  const owner = fakeOwner()
  const water = fakeWater()
  const manager = new FoodManager(bot, foodConfig(), silentLogger)
  manager.attach(owner, water)
  manager.start()
  t.after(() => manager.stop())

  await manager.check()
  bot.food = 10
  const resumed = manager.manualResume()

  assert.equal(resumed, true)
  assert.equal(manager.waitingForFood, false)
  assert.equal(owner.released, 1)
  assert.equal(water.states.at(-1), false)
})

test('food manager only warns when food is low but not critical', async t => {
  const bot = fakeBot({ food: 10, items: [] })
  const owner = fakeOwner()
  const starved = []
  const manager = new FoodManager(bot, foodConfig(), silentLogger, {
    onStarving: food => starved.push(food)
  })
  manager.attach(owner)
  manager.start()
  t.after(() => manager.stop())

  await manager.check()

  assert.equal(manager.waitingForFood, false)
  assert.equal(owner.held, 0)
  assert.equal(starved.length, 0)
  assert.equal(bot.whispers.length, 0)
})

test('food manager retries after a failed consume', async t => {
  const bot = fakeBot({ food: 10, items: [item('bread', 3)], consumeError: 'interrupted' })
  const manager = new FoodManager(bot, foodConfig(), silentLogger)
  manager.start()
  t.after(() => manager.stop())

  await manager.check()
  assert.equal(manager.pending, true)
  assert.equal(bot.consumed, 0)

  bot.consume = async () => {
    bot.consumed++
    bot.food = 20
  }
  manager.lastAttemptAt = 0
  await manager.check()
  assert.equal(bot.consumed, 1)
  assert.equal(manager.pending, false)
})

test('pickFood chooses the highest effective quality', () => {
  const bot = fakeBot({
    items: [item('bread', 1), item('cooked_beef', 1), item('golden_carrot', 1)]
  })
  const choice = pickFood(bot, mcData)
  assert.equal(choice.item.name, 'cooked_beef')
})
