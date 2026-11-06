'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('events')
const Vec3 = require('vec3')
const { MaceSmasher } = require('../src/combat/mace')
const { HotbarLoadout } = require('../src/combat/loadout')

const silent = { info () {}, debug () {}, warn () {}, error () {} }

function items () {
  return [
    { name: 'mace', count: 1 }, { name: 'diamond_sword', count: 1 },
    { name: 'wind_charge', count: 8 }, { name: 'firework_rocket', count: 16 },
    { name: 'netherite_axe', count: 1 }, { name: 'water_bucket', count: 1 },
    { name: 'golden_apple', count: 4 }
  ]
}

function fakeBot ({ onGround = true } = {}) {
  const bot = new EventEmitter()
  const slots = new Array(46).fill(null)
  items().forEach((it, i) => { slots[9 + i] = it })
  bot.inventory = { slots, items: () => slots.filter(Boolean) }
  bot.moveSlotItem = async (from, to) => { const t = slots[to]; slots[to] = slots[from]; slots[from] = t }
  bot.equip = async () => {}
  bot.setQuickBarSlot = i => { bot.quickBar = i }
  bot.entity = { position: new Vec3(0, 64, 0), velocity: new Vec3(0, 0, 0), onGround, id: 1 }
  bot.controls = {}
  bot.setControlState = (k, v) => { bot.controls[k] = v }
  bot.looks = []
  bot.lookAt = async (p) => { bot.looks.push(p) }
  bot.look = async (yaw, pitch) => { bot.lookCalls.push([yaw, pitch]) }
  bot.lookCalls = []
  bot.attacks = []
  bot.attack = e => bot.attacks.push(e)
  bot.activations = 0
  bot.activateItem = () => { bot.activations++ }
  bot.deactivateItem = () => {}
  bot.blockAt = () => ({ name: 'grass_block', position: new Vec3(0, 63, 0) })
  bot._client = { write () {} }
  return bot
}

const target = () => ({ position: new Vec3(0, 64, 6), velocity: new Vec3(0, 0, 0), height: 1.8 })

async function driveLaunch (bot, promise) {
  for (let i = 0; i < 3; i++) {
    await new Promise(resolve => setTimeout(resolve, 5))
    bot.emit('physicsTick')
  }
  return promise
}

test('launch: hadap bawah dulu, lompat, pakai wind charge, pindah ke slot 0', async () => {
  const bot = fakeBot()
  const order = []
  let stopped = 0
  bot.pathfinder = { stop: () => { stopped++ } }
  const originalLook = bot.look
  bot.look = async (yaw, pitch) => { order.push('look'); await originalLook(yaw, pitch) }
  const originalControl = bot.setControlState
  bot.setControlState = (key, value) => {
    if (key === 'jump' && value) order.push('jump')
    originalControl(key, value)
  }
  bot.activateItem = () => { order.push('throw'); bot.activations++ }
  const loadout = new HotbarLoadout(bot, {})
  const mace = new MaceSmasher(bot, loadout, silent, {})

  await driveLaunch(bot, mace.launch(target()))

  assert.equal(stopped, 1, 'pathfinder tidak boleh melawan arah pandang combo')
  assert.deepEqual(order, ['look', 'jump', 'throw'])
  assert.equal(bot.controls.jump, false, 'jump dilepas setelah 1 tick')
  assert.ok(bot.lookCalls.length >= 1)
  assert.ok(Math.abs(bot.lookCalls[0][1] - (-Math.PI / 2)) < 1e-6, 'pitch menghadap ke bawah')
  assert.equal(bot.activations, 1, 'wind charge dipakai sekali')
  assert.equal(bot.quickBar, 0, 'kembali ke slot mace')
  assert.equal(mace.stats.launches, 1)
})

test('launch ditolak bila sedang di udara', async () => {
  const bot = fakeBot({ onGround: false })
  const mace = new MaceSmasher(bot, new HotbarLoadout(bot, {}), silent, {})
  assert.equal(await mace.launch(target()), false)
})

test('smash: bidik kepala prediktif lalu attack', async () => {
  const bot = fakeBot()
  const mace = new MaceSmasher(bot, new HotbarLoadout(bot, {}), silent, { leadTicks: 1 })
  const t = target()
  t.velocity = new Vec3(0, 0, 0.4)
  await mace.smash(t)
  assert.equal(bot.attacks.length, 1)
  assert.ok(Math.abs(bot.looks[0].z - 6.4) < 0.001, 'bidik 1 tick ke depan')
  assert.equal(mace.stats.smashes, 1)
})

test('smash kedua dalam satu luncuran dihitung sebagai chain', async () => {
  const bot = fakeBot()
  const mace = new MaceSmasher(bot, new HotbarLoadout(bot, {}), silent, {})
  await mace.smash(target())
  await mace.smash(target())
  assert.equal(mace.stats.smashes, 2)
  assert.equal(mace.stats.chains, 1)
})

test('clutch: pilih water bucket, taruh air, 1 tick, ambil lagi', async () => {
  const bot = fakeBot()
  const loadout = new HotbarLoadout(bot, {})
  await loadout.arrange()
  const mace = new MaceSmasher(bot, loadout, silent, {})
  const p = mace.clutch()
  await new Promise(r => setTimeout(r, 5))
  bot.emit('physicsTick')
  assert.equal(await p, true)
  assert.equal(bot.activations, 2, 'taruh lalu ambil kembali')
  assert.equal(mace.stats.clutches, 1)
})

test('canLaunch memeriksa amunisi dan perisai', async () => {
  const bot = fakeBot()
  const loadout = new HotbarLoadout(bot, {})
  const mace = new MaceSmasher(bot, loadout, silent, {})
  assert.equal(mace.canLaunch({ distance: 6, dy: 0, blocking: false }), true)
  assert.equal(mace.canLaunch({ distance: 6, dy: 0, blocking: true }), false)
  assert.equal(mace.canLaunch({ distance: 12, dy: 0, blocking: false }), false)
})

test('hasWindBurst membaca enchant mace dengan aman', () => {
  const bot = fakeBot()
  const loadout = new HotbarLoadout(bot, {})
  const mace = new MaceSmasher(bot, loadout, silent, {})
  assert.equal(mace.hasWindBurst(), false)
  loadout.item = () => ({ name: 'mace', enchants: [{ name: 'wind_burst', lvl: 2 }] })
  assert.equal(mace.hasWindBurst(), true)
  loadout.item = () => ({ name: 'mace', enchants: [{ name: 'minecraft:wind_burst', lvl: 1 }] })
  assert.equal(mace.hasWindBurst(), true)
})

test('launch memaksa pitch -90 derajat (straight down) sebelum wind charge', async () => {
  const bot = fakeBot()
  const mace = new MaceSmasher(bot, new HotbarLoadout(bot, {}), silent, {})
  await driveLaunch(bot, mace.launch(target()))
  assert.ok(bot.lookCalls.length >= 1)
  assert.ok(Math.abs(bot.lookCalls[0][1] - (-Math.PI / 2)) < 1e-6)
})

test('launch tidak mengirim release_use_item untuk wind charge', async () => {
  const bot = fakeBot()
  let releases = 0
  bot.deactivateItem = () => { releases++ }
  const mace = new MaceSmasher(bot, new HotbarLoadout(bot, {}), silent, {})
  await driveLaunch(bot, mace.launch(target()))
  assert.equal(releases, 0)
})

test('launch tetap tersedia saat target berada di jarak melee dan punya cooldown anti-spam', async () => {
  const bot = fakeBot()
  const mace = new MaceSmasher(bot, new HotbarLoadout(bot, {}), silent, {})
  assert.equal(mace.canLaunch({ distance: 2, dy: 0 }), true)
  await driveLaunch(bot, mace.launch(target()))
  assert.equal(mace.canLaunch({ distance: 2, dy: 0 }), false, 'tidak membakar semua charge bila server menolak launch')
})
