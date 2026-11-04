'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const Vec3 = require('vec3')
const { goals } = require('mineflayer-pathfinder')
const {
  lavaNear,
  isInLava,
  isStandable,
  findSafeSpot,
  escapeLava,
  LavaGuard
} = require('../src/safety/lava')

const silentLogger = {
  info () {},
  warn () {},
  debug () {},
  error () {}
}

const LIQUIDS = new Set(['lava', 'flowing_lava', 'water', 'fire', 'soul_fire'])
const EMPTY = new Set(['air', 'cave_air', 'void_air'])

function blockOf (name) {
  const solid = !LIQUIDS.has(name) && !EMPTY.has(name)
  return {
    name,
    boundingBox: solid ? 'block' : 'empty',
    diggable: solid
  }
}

function worldBot (layout = {}, options = {}) {
  const blocks = new Map(Object.entries(layout))
  const bot = {
    entity: { position: options.position || new Vec3(0, 64, 0), onFire: false },
    health: options.health ?? 20,
    food: options.food ?? 20,
    controls: [],
    pathfinder: {
      stopCalls: 0,
      goals: [],
      stop () { this.stopCalls++ },
      async goto (goal) {
        this.goals.push(goal)
        if (options.gotoError) throw options.gotoError
      }
    },
    setControlState (name, value) { this.controls.push([name, value]) },
    clearControlStates () { this.controls.length = 0 },
    blockAt (p) {
      return blocks.get(`${p.x},${p.y},${p.z}`) || blockOf('air')
    }
  }
  bot.blocks = blocks
  return bot
}

// Lantai batu di Y=63, ruang kosong di atasnya.
function floorWorld (extra = {}) {
  const layout = {}
  for (let x = -10; x <= 10; x++) {
    for (let z = -10; z <= 10; z++) {
      layout[`${x},63,${z}`] = blockOf('netherrack')
    }
  }
  return Object.assign(layout, extra)
}

test('lavaNear mendeteksi lava diagonal, bukan hanya 6 sisi', () => {
  const bot = worldBot({ '1,64,1': blockOf('lava') })
  const center = new Vec3(0, 64, 0)

  assert.equal(lavaNear(bot, center, 0), false)
  assert.equal(lavaNear(bot, center, 1), true, 'lava diagonal harus terdeteksi')
  assert.equal(lavaNear(bot, new Vec3(5, 64, 5), 1), false)
})

test('isInLava membaca blok kaki, kepala, dan status terbakar', () => {
  const bot = worldBot()
  assert.equal(isInLava(bot), false)

  bot.blocks.set('0,64,0', blockOf('lava'))
  assert.equal(isInLava(bot), true)

  bot.blocks.set('0,64,0', blockOf('air'))
  bot.blocks.set('0,65,0', blockOf('flowing_lava'))
  assert.equal(isInLava(bot), true)

  bot.blocks.delete('0,65,0')
  bot.entity.onFire = true
  assert.equal(isInLava(bot), true)
})

test('isStandable butuh kaki & kepala kosong dan lantai padat', () => {
  const bot = worldBot(floorWorld())

  assert.equal(isStandable(bot, new Vec3(0, 64, 0)), true)
  assert.equal(isStandable(bot, new Vec3(0, 63, 0)), false, 'di dalam lantai')
  assert.equal(isStandable(bot, new Vec3(0, 70, 0)), false, 'melayang tanpa lantai')

  bot.blocks.set('2,63,2', blockOf('lava'))
  assert.equal(isStandable(bot, new Vec3(2, 64, 2)), false, 'lantai lava bukan tempat aman')
})

test('findSafeSpot memilih tempat terdekat yang jauh dari lava', () => {
  const bot = worldBot(floorWorld({ '1,63,1': blockOf('lava') }), { position: new Vec3(0, 64, 0) })
  bot.blocks.set('0,64,0', blockOf('lava'))

  const spot = findSafeSpot(bot, { radius: 6 })
  assert.ok(spot, 'harus menemukan tempat aman')
  assert.equal(lavaNear(bot, spot, 1), false)
  assert.ok(spot.distanceTo(new Vec3(0, 64, 0)) <= 6)
})

test('escapeLava menghentikan pathfinder lalu berjalan ke tempat aman', async () => {
  const logs = []
  const logger = { ...silentLogger, warn: msg => logs.push(msg) }
  const bot = worldBot(floorWorld(), { position: new Vec3(0, 64, 0) })
  bot.blocks.set('0,64,0', blockOf('lava'))

  const result = await escapeLava(bot, { logger })

  assert.equal(result.ok, true)
  assert.equal(result.moved, true)
  assert.ok(result.spot)
  assert.equal(bot.pathfinder.stopCalls, 1)
  assert.ok(bot.pathfinder.goals[0] instanceof goals.GoalBlock)
  assert.ok(logs.some(msg => /lava/i.test(msg)))
})

test('escapeLava tidak melakukan apa pun kalau bot tidak di lava', async () => {
  const bot = worldBot(floorWorld())
  const result = await escapeLava(bot, { logger: silentLogger })

  assert.equal(result.moved, false)
  assert.equal(bot.pathfinder.goals.length, 0)
})

test('escapeLava tetap bergerak manual saat pathfinder gagal', async () => {
  const bot = worldBot(floorWorld(), { gotoError: new Error('No path to the goal!') })
  bot.blocks.set('0,64,0', blockOf('lava'))

  const result = await escapeLava(bot, { logger: silentLogger })

  assert.equal(result.ok, true)
  assert.equal(result.fallback, true)
  assert.ok(bot.controls.some(([name, value]) => name === 'jump' && value === true))
})

test('LavaGuard bereaksi saat bot masuk lava dan tidak menumpuk escape', async () => {
  const logs = []
  const logger = { ...silentLogger, warn: msg => logs.push(msg) }
  const bot = worldBot(floorWorld())
  bot.blocks.set('0,64,0', blockOf('lava'))

  const guard = new LavaGuard(bot, { safety: { lava: { checkIntervalMs: 1 } } }, logger)
  await guard.tick()
  await guard.tick()

  assert.equal(guard.escapes, 1, 'selama masih di lava, escape tidak boleh berulang tiap tick')
  assert.ok(logs.some(msg => /lava/i.test(msg)))
  guard.stop()
})

test('LavaGuard tidak melakukan apa pun saat keamanan lava dimatikan', async () => {
  const bot = worldBot(floorWorld())
  bot.blocks.set('0,64,0', blockOf('lava'))

  const guard = new LavaGuard(bot, { safety: { lava: { enabled: false } } }, silentLogger)
  await guard.tick()

  assert.equal(guard.escapes, 0)
})
