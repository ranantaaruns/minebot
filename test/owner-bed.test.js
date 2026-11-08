'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('events')
const Vec3 = require('vec3')
const { BedSpawnSync, isBedBlock } = require('../src/owner-bed')

const silent = { info () {}, debug () {}, warn () {}, error () {} }

function fakeBot (world = {}) {
  const bot = new EventEmitter()
  bot.entity = { id: 1, position: new Vec3(0, 64, 5) }
  bot.isSleeping = false
  bot.sleeps = []
  bot.goals = []
  bot.warnings = []
  bot.blockAt = pos => {
    const name = world[`${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`]
    return { name: name || 'air', position: pos.floored() }
  }
  bot.pathfinder = {
    async goto (goal) { bot.goals.push(goal); bot.entity.position = new Vec3(goal.x, goal.y, goal.z + 1) },
    stop () {}
  }
  bot.sleep = async block => {
    if (block.name.endsWith('_occupied')) throw new Error('the bed is occupied')
    bot.sleeps.push(block.position)
    bot.isSleeping = true
  }
  return bot
}

const logger = {
  info () {},
  debug () {},
  warn (msg) { this.last = msg },
  error () {}
}

test('isBedBlock mengenali semua warna kasur', () => {
  assert.equal(isBedBlock({ name: 'red_bed' }), true)
  assert.equal(isBedBlock({ name: 'white_bed' }), true)
  assert.equal(isBedBlock({ name: 'bed' }), true)
  assert.equal(isBedBlock({ name: 'oak_planks' }), false)
  assert.equal(isBedBlock(null), false)
})

test('owner tidur -> bot ikut tidur di kasur yang sama', async () => {
  const bot = fakeBot({ '0,64,0': 'red_bed' })
  const sync = new BedSpawnSync(bot, { username: 'Owner' }, silent)
  sync.start()
  bot.emit('entitySleep', { username: 'Owner', position: new Vec3(0, 64, 0) })
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(bot.sleeps.length, 1)
  assert.deepEqual(bot.sleeps[0], new Vec3(0, 64, 0))
  assert.equal(sync.stats.syncs, 1)
  sync.stop()
})

test('pemain lain tidur tidak memicu apa pun', async () => {
  const bot = fakeBot({ '0,64,0': 'red_bed' })
  const sync = new BedSpawnSync(bot, { username: 'Owner' }, silent)
  sync.start()
  bot.emit('entitySleep', { username: 'OrangLain', position: new Vec3(0, 64, 0) })
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(bot.sleeps.length, 0)
  sync.stop()
})

test('kasur owner penuh -> bot memakai kasur kosong di sebelahnya', async () => {
  const bot = fakeBot({ '0,64,0': 'red_bed', '2,64,0': 'blue_bed' })
  const sync = new BedSpawnSync(bot, { username: 'Owner' }, silent)
  // Kasur owner sedang dipakai owner sendiri (vanilla: 1 kasur 1 pemain).
  const originalSleep = bot.sleep
  let calls = 0
  bot.sleep = async block => {
    calls++
    if (calls === 1) throw new Error('the bed is occupied')
    return originalSleep(block)
  }
  sync.start()
  bot.emit('entitySleep', { username: 'Owner', position: new Vec3(0, 64, 0) })
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(bot.sleeps.length, 1)
  assert.deepEqual(bot.sleeps[0], new Vec3(2, 64, 0), 'kasur tetangga dipakai')
  sync.stop()
})

test('tidak ada kasur di sekitar owner -> hanya peringatan, tidak crash', async () => {
  const bot = fakeBot({})
  const sync = new BedSpawnSync(bot, { username: 'Owner' }, logger)
  sync.start()
  bot.emit('entitySleep', { username: 'Owner', position: new Vec3(0, 64, 0) })
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(bot.sleeps.length, 0)
  assert.match(logger.last || '', /kasur/i)
  sync.stop()
})

test('bot yang sudah tidur tidak tidur dua kali', async () => {
  const bot = fakeBot({ '0,64,0': 'red_bed' })
  bot.isSleeping = true
  const sync = new BedSpawnSync(bot, { username: 'Owner' }, silent)
  sync.start()
  bot.emit('entitySleep', { username: 'Owner', position: new Vec3(0, 64, 0) })
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(bot.sleeps.length, 0)
  sync.stop()
})

test('syncBedSpawn=false mematikan fitur', async () => {
  const bot = fakeBot({ '0,64,0': 'red_bed' })
  const sync = new BedSpawnSync(bot, { username: 'Owner', syncBedSpawn: false }, silent)
  sync.start()
  bot.emit('entitySleep', { username: 'Owner', position: new Vec3(0, 64, 0) })
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(bot.sleeps.length, 0)
  sync.stop()
})

test('stop melepas listener', () => {
  const bot = fakeBot({})
  const sync = new BedSpawnSync(bot, { username: 'Owner' }, silent)
  sync.start()
  assert.equal(bot.listenerCount('entitySleep'), 1)
  sync.stop()
  assert.equal(bot.listenerCount('entitySleep'), 0)
})
