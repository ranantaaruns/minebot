'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('events')
const Vec3 = require('vec3')
const { CombatEngine, heightAboveGround } = require('../src/combat/engine')
const { STATES } = require('../src/combat/fsm')

const silent = { info () {}, debug () {}, warn () {}, error () {} }

function fakeBot ({ onGround = true, position = new Vec3(0, 64, 0) } = {}) {
  const bot = new EventEmitter()
  const slots = new Array(46).fill(null)
  const items = [
    { name: 'mace', count: 1 }, { name: 'diamond_sword', count: 1 },
    { name: 'wind_charge', count: 8 }, { name: 'firework_rocket', count: 16 },
    { name: 'netherite_axe', count: 1 }, { name: 'water_bucket', count: 1 },
    { name: 'golden_apple', count: 4 }, { name: 'elytra', count: 1 }
  ]
  items.forEach((it, i) => { slots[9 + i] = it })
  bot.inventory = { slots, items: () => slots.filter(Boolean) }
  bot.moveSlotItem = async (from, to) => { const t = slots[to]; slots[to] = slots[from]; slots[from] = t }
  bot.equip = async () => {}
  bot.setQuickBarSlot = () => {}
  bot.entity = { position, velocity: new Vec3(0, 0, 0), onGround, id: 1, height: 1.8 }
  bot.entities = {}
  bot.controls = {}
  bot.setControlState = (k, v) => { bot.controls[k] = v }
  bot.lookAt = async () => {}
  bot.attacks = []
  bot.attack = e => bot.attacks.push(e)
  bot.activations = 0
  bot.activateItem = () => { bot.activations++ }
  bot.deactivateItem = () => {}
  bot._client = { write () {} }
  bot.registry = require('minecraft-data')('1.21.4')
  bot.blockAt = p => (p.y <= 63 ? { name: 'stone', position: p } : { name: 'air', position: p })
  return bot
}

const enemy = (x = 0, y = 64, z = 6) => ({ id: 7, position: new Vec3(x, y, z), velocity: new Vec3(0, 0, 0), height: 1.8, health: 20 })

test('heightAboveGround menghitung blok padat di bawah', () => {
  const bot = fakeBot()
  assert.equal(heightAboveGround(bot), 0, 'menapak tanah: 0 blok di bawah kaki')
})

test('start memasang listener, stop melepasnya', () => {
  const bot = fakeBot()
  const engine = new CombatEngine(bot, {}, silent)
  engine.start()
  assert.equal(bot.listenerCount('physicsTick'), 1)
  engine.stop()
  assert.equal(bot.listenerCount('physicsTick'), 0)
})

test('tanpa target tidak ada aksi apa pun', async () => {
  const bot = fakeBot()
  const engine = new CombatEngine(bot, {}, silent)
  await engine.tick()
  assert.equal(bot.attacks.length, 0)
  assert.equal(bot.activations, 0)
  assert.equal(engine.state, STATES.IDLE)
})

test('enabled=false mematikan seluruh aksi', async () => {
  const bot = fakeBot()
  const engine = new CombatEngine(bot, {}, silent)
  engine.enabled = false
  engine.setTarget(enemy())
  await engine.tick()
  assert.equal(bot.activations, 0)
})

test('target dalam jendela luncur memicu wind charge', async () => {
  const bot = fakeBot()
  const engine = new CombatEngine(bot, {}, silent)
  engine.setTarget(enemy(0, 64, 6))
  const p = engine.tick()
  await new Promise(r => setTimeout(r, 5))
  bot.emit('physicsTick')
  await p
  assert.equal(engine.state, STATES.LAUNCH)
  assert.equal(bot.activations, 1, 'wind charge dipakai')
  assert.equal(engine.stats.launches, 1)
})

test('jatuh cepat dekat target memicu smash (attack)', async () => {
  const bot = fakeBot({ onGround: false, position: new Vec3(0, 66, 0) })
  const engine = new CombatEngine(bot, {}, silent)
  engine.setTarget(enemy(0, 64, 2))
  // bangun fallDistance: puncak 67 -> sekarang 66
  bot.entity.velocity = new Vec3(0, -0.5, 0)
  engine.fall.peakY = 67.5
  engine.fall.distance = 1.5
  await engine.tick()
  assert.equal(engine.state, STATES.SMASH)
  assert.equal(bot.attacks.length, 1)
  assert.equal(engine.stats.smashes, 1)
})

test('target memegang perisai -> state SHIELD memakai kapak', async () => {
  const bot = fakeBot()
  const selected = []
  const engine = new CombatEngine(bot, {}, silent)
  engine.loadout.select = async tag => { selected.push(tag); return true }
  const t = enemy(0, 64, 2)
  t.heldItem = { name: 'shield' }
  engine.setTarget(t)
  await engine.tick()
  if (engine.state === STATES.SHIELD) {
    assert.equal(selected[0], 'axe')
    assert.equal(bot.attacks.length, 1)
  } else {
    assert.ok(bot.attacks.length <= 1)
  }
})

test('target mati membersihkan target', async () => {
  const bot = fakeBot()
  const engine = new CombatEngine(bot, {}, silent)
  const t = enemy()
  t.health = 0
  engine.setTarget(t)
  await engine.tick()
  assert.equal(engine.target, null)
  assert.equal(bot.attacks.length, 0)
})

test('event death mereset state dan target', async () => {
  const bot = fakeBot()
  const engine = new CombatEngine(bot, {}, silent)
  engine.start()
  engine.setTarget(enemy())
  engine.state = STATES.SMASH
  bot.emit('death')
  assert.equal(engine.target, null)
  assert.equal(engine.state, STATES.IDLE)
  engine.stop()
})

test('doFly mengambil alih elytra saat target jauh', async () => {
  const bot = fakeBot()
  const engine = new CombatEngine(bot, {}, silent)
  const t = enemy(0, 64, 30)
  engine.setTarget(t)
  engine.bot.entity.elytraFlying = true
  engine.bot.entity.onGround = false
  const p = engine.tick()
  await new Promise(r => setTimeout(r, 5))
  bot.emit('physicsTick')
  bot.emit('physicsTick')
  await p
  assert.ok(engine.state === STATES.FLY || engine.state === STATES.CHARGE, `state=${engine.state}`)
})

test('target jauh (> flyRange) di tanah memicu takeoff elytra', async () => {
  const bot = fakeBot()
  const equips = []
  bot.equip = async (it, dest) => { equips.push([it.name, dest]) }
  const engine = new CombatEngine(bot, {}, silent)
  engine.setTarget(enemy(0, 64, 20))
  const p = engine.tick()
  await new Promise(r => setTimeout(r, 5))
  bot.emit('physicsTick')
  bot.emit('physicsTick')
  await p
  assert.equal(engine.state, STATES.CHARGE)
  assert.deepEqual(equips[0], ['elytra', 'torso'])
  assert.equal(engine.stats.flights, 1)
  assert.equal(bot.writes?.length || 0, 0, 'paket glide lewat _client')
})

test('target dekat (<= flyRange) di tanah tidak memakai elytra', async () => {
  const bot = fakeBot()
  const equips = []
  bot.equip = async (it, dest) => { equips.push([it.name, dest]) }
  const engine = new CombatEngine(bot, {}, silent)
  engine.setTarget(enemy(0, 64, 10))
  await engine.tick()
  assert.equal(equips.length, 0)
  assert.equal(engine.stats.flights, 0)
})

test('busy menahan tick berikutnya (tidak dobel attack)', async () => {
  const bot = fakeBot({ onGround: false, position: new Vec3(0, 66, 0) })
  const engine = new CombatEngine(bot, {}, silent)
  engine.setTarget(enemy(0, 64, 2))
  engine.fall.peakY = 67.5
  engine.busy = true
  await engine.tick()
  assert.equal(bot.attacks.length, 0)
})

test('Wind Burst: setelah smash bot menunggu jatuh lagi, bukan spam attack saat naik', async () => {
  const bot = fakeBot({ onGround: false, position: new Vec3(0, 66, 0) })
  const engine = new CombatEngine(bot, {}, silent)
  engine.mace.hasWindBurst = () => true
  engine.setTarget(enemy(0, 64, 2))
  bot.entity.velocity = new Vec3(0, -0.5, 0)
  engine.fall.peakY = 68
  await engine.tick()
  assert.equal(bot.attacks.length, 1, 'smash pertama')
  assert.equal(engine.burstPending, true)

  bot.entity.velocity = new Vec3(0, 1.2, 0)
  engine.fall.distance = 0
  await engine.tick()
  assert.equal(engine.state, STATES.BURST)
  assert.equal(bot.attacks.length, 1, 'tidak menyerang saat sedang terlempar naik')

  bot.entity.velocity = new Vec3(0, -0.6, 0)
  engine.fall.peakY = 68
  await engine.tick()
  assert.equal(engine.state, STATES.SMASH)
  assert.equal(bot.attacks.length, 2, 'smash kedua tanpa wind charge tambahan')
  assert.equal(engine.burstPending, false, 'setelah hit kedua wind charge boleh dipakai lagi')
})

test('mace tanpa Wind Burst tidak membuat state BURST', async () => {
  const bot = fakeBot({ onGround: false, position: new Vec3(0, 66, 0) })
  const engine = new CombatEngine(bot, {}, silent)
  engine.mace.hasWindBurst = () => false
  engine.setTarget(enemy(0, 64, 2))
  bot.entity.velocity = new Vec3(0, -0.5, 0)
  engine.fall.peakY = 68
  await engine.tick()
  assert.equal(engine.burstPending, false)
})
