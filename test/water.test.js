'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('events')
const Vec3 = require('vec3')
const { WaterNavigator } = require('../src/navigation/water')
const { sleep } = require('../src/util/async')

const silentLogger = {
  info () {},
  warn () {},
  debug () {},
  error () {}
}

function waterConfig (overrides = {}) {
  return {
    owner: {
      swim: {
        enabled: true,
        liquidCost: 12,
        updateMs: 0,
        timeoutMs: 120000,
        shoreStrafeAfterMs: 2000,
        strafeMs: 800,
        approachFromShore: true,
        approachScanDistance: 16,
        approachTimeoutMs: 4000,
        ...overrides
      }
    },
    safety: {
      preventDrowning: true
    }
  }
}

function fakeBot (options = {}) {
  const bot = new EventEmitter()
  bot.version = '1.21.4'
  bot.entity = {
    position: options.position || new Vec3(0, 64, 0),
    isInWater: options.isInWater ?? false,
    isCollidedHorizontally: false
  }
  bot.controls = new Map()
  bot.goals = []
  bot.pathfinder = {
    goal: null,
    setGoal (goal) {
      this.goal = goal
      bot.goals.push(goal)
    }
  }
  bot.setControlState = (name, value) => bot.controls.set(name, value)
  bot.look = async () => {}
  bot.blockAt = options.blockAt || (() => ({ name: 'stone', boundingBox: 'block' }))
  return bot
}

test('water navigator floats and steers toward the target', t => {
  const bot = fakeBot({ isInWater: true })
  let entered = 0
  const water = new WaterNavigator(bot, waterConfig(), silentLogger, {
    getTarget: () => new Vec3(10, 64, 0),
    onEnterWater: () => { entered++ }
  })
  t.after(() => water.destroy())

  bot.emit('physicsTick')

  assert.equal(water.active, true)
  assert.equal(entered, 1)
  assert.equal(bot.controls.get('jump'), true)
  assert.equal(bot.controls.get('forward'), true)
  assert.equal(bot.controls.get('sprint'), false)
})

test('water navigator keeps jumping while eating', t => {
  const bot = fakeBot({ isInWater: true })
  const water = new WaterNavigator(bot, waterConfig(), silentLogger, {
    getTarget: () => new Vec3(10, 64, 0)
  })
  t.after(() => water.destroy())

  bot.emit('physicsTick')
  water.setPaused(true)
  bot.emit('physicsTick')

  assert.equal(bot.controls.get('jump'), true)
  assert.equal(bot.controls.get('forward'), false)
})

test('water navigator releases controls after leaving water', t => {
  const bot = fakeBot({ isInWater: true })
  let exited = 0
  const water = new WaterNavigator(bot, waterConfig(), silentLogger, {
    getTarget: () => new Vec3(10, 64, 0),
    onExitWater: () => { exited++ }
  })
  t.after(() => water.destroy())

  bot.emit('physicsTick')
  bot.entity.isInWater = false
  bot.emit('physicsTick')
  assert.equal(water.active, true)
  assert.equal(exited, 0)

  bot.emit('physicsTick')

  assert.equal(water.active, false)
  assert.equal(exited, 1)
  for (const name of ['jump', 'forward', 'left', 'right', 'sprint']) {
    assert.equal(bot.controls.get(name), false)
  }
})

test('water navigator ignores a single dry tick at the surface', t => {
  const bot = fakeBot({ isInWater: true })
  let entered = 0
  let exited = 0
  const water = new WaterNavigator(bot, waterConfig(), silentLogger, {
    getTarget: () => new Vec3(10, 64, 0),
    onEnterWater: () => { entered++ },
    onExitWater: () => { exited++ }
  })
  t.after(() => water.destroy())

  bot.emit('physicsTick')
  bot.entity.isInWater = false
  bot.emit('physicsTick')
  bot.entity.isInWater = true
  bot.emit('physicsTick')

  assert.equal(water.active, true)
  assert.equal(entered, 1)
  assert.equal(exited, 0)
  assert.equal(bot.controls.get('jump'), true)
  assert.equal(bot.controls.get('forward'), true)
})

test('water navigator leaves steering to pathfinder during a job', t => {
  const bot = fakeBot({ isInWater: true })
  const water = new WaterNavigator(bot, waterConfig({ timeoutMs: 1 }), silentLogger, {
    getTarget: () => null,
    getJobPaused: () => true
  })
  t.after(() => water.destroy())
  bot.controls.set('forward', true)

  bot.emit('physicsTick')

  assert.equal(water.active, true)
  assert.equal(water.timedOut, false)
  assert.equal(bot.controls.get('jump'), true)
  assert.equal(bot.controls.get('forward'), true)
})

test('water navigator keeps floating after a swim timeout', async t => {
  const bot = fakeBot({ isInWater: true })
  const water = new WaterNavigator(bot, waterConfig({ timeoutMs: 1 }), silentLogger, {
    getTarget: () => new Vec3(10, 64, 0)
  })
  t.after(() => water.destroy())

  bot.emit('physicsTick')
  await sleep(10)
  bot.emit('physicsTick')

  assert.equal(water.timedOut, true)
  assert.equal(bot.controls.get('jump'), true)
  assert.equal(bot.controls.get('forward'), false)
})

test('water navigator detects water toward the target', t => {
  const bot = fakeBot({
    blockAt: position => {
      if (position.x === 2 && position.y === 64) return { name: 'water', boundingBox: 'empty' }
      return { name: 'stone', boundingBox: 'block' }
    }
  })
  const water = new WaterNavigator(bot, waterConfig(), silentLogger)
  t.after(() => water.destroy())

  assert.equal(water.canApproach(new Vec3(40, 64, 0)), true)
})

test('water navigator enters swim mode after a shore approach', async t => {
  const bot = fakeBot()
  const water = new WaterNavigator(bot, waterConfig(), silentLogger, {
    getTarget: () => new Vec3(10, 64, 0)
  })
  t.after(() => water.destroy())
  water.canApproach = () => true

  const approach = water.approach(new Vec3(10, 64, 0))
  bot.emit('physicsTick')
  assert.equal(bot.controls.get('forward'), true)

  bot.entity.isInWater = true
  bot.emit('physicsTick')

  assert.equal(await approach, true)
  assert.equal(water.active, true)
})
