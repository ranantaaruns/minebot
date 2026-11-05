'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('events')
const Vec3 = require('vec3')
const { ElytraFlyer } = require('../src/combat/fly')
const { HotbarLoadout } = require('../src/combat/loadout')

const silent = { info () {}, debug () {}, warn () {}, error () {} }

function fakeBot () {
  const bot = new EventEmitter()
  const slots = new Array(46).fill(null)
  const items = [
    { name: 'mace', count: 1 }, { name: 'diamond_sword', count: 1 },
    { name: 'wind_charge', count: 8 }, { name: 'firework_rocket', count: 16 },
    { name: 'netherite_axe', count: 1 }, { name: 'water_bucket', count: 1 },
    { name: 'golden_apple', count: 4 }, { name: 'elytra', count: 1 },
    { name: 'netherite_chestplate', count: 1 }
  ]
  items.forEach((it, i) => { slots[9 + i] = it })
  bot.inventory = { slots, items: () => slots.filter(Boolean) }
  bot.moveSlotItem = async (from, to) => { const t = slots[to]; slots[to] = slots[from]; slots[from] = t }
  bot.equip = async (it, dest) => { bot.equipCalls.push([it.name, dest]); if (dest === 'torso') slots[6] = it }
  bot.equipCalls = []
  bot.setQuickBarSlot = i => { bot.quickBar = i }
  bot.entity = { position: new Vec3(0, 70, 0), velocity: new Vec3(0, 0, 0), onGround: true, id: 1, elytraFlying: false }
  bot.controls = {}
  bot.setControlState = (k, v) => { bot.controls[k] = v }
  bot.looks = []
  bot.lookAt = async p => { bot.looks.push(p) }
  bot.attacks = []
  bot.attack = e => bot.attacks.push(e)
  bot.activations = 0
  bot.activateItem = () => { bot.activations++ }
  bot.deactivateItem = () => {}
  bot.writes = []
  bot._client = { write: (name, params) => bot.writes.push([name, params]) }
  bot.registry = require('minecraft-data')('1.21.4')
  return bot
}

test('takeOff memasang elytra, lompat 2 tick, lalu kirim paket glide', async () => {
  const bot = fakeBot()
  const flyer = new ElytraFlyer(bot, new HotbarLoadout(bot, {}), silent, {})
  const p = flyer.takeOff()
  await new Promise(r => setTimeout(r, 5))
  bot.emit('physicsTick')
  bot.emit('physicsTick')
  assert.equal(await p, true)
  assert.equal(bot.equipCalls[0][0], 'elytra')
  assert.equal(bot.writes.length, 1, 'satu paket start_fall_flying')
  assert.equal(bot.writes[0][1].actionId, 8)
  assert.equal(bot.controls.jump, false)
  assert.equal(flyer.stats.takeoffs, 1)
})

test('takeOff gagal tanpa elytra', async () => {
  const bot = fakeBot()
  bot.inventory.slots[16] = null
  const flyer = new ElytraFlyer(bot, new HotbarLoadout(bot, {}), silent, {})
  assert.equal(await flyer.takeOff(), false)
})

test('boost memakai firework lalu lepas', async () => {
  const bot = fakeBot()
  const flyer = new ElytraFlyer(bot, new HotbarLoadout(bot, {}), silent, {})
  assert.equal(await flyer.boost(), true)
  assert.equal(bot.activations, 1)
  assert.equal(flyer.stats.boosts, 1)
})

test('boost ditolak saat amunisi habis', async () => {
  const bot = fakeBot()
  bot.inventory.slots[12] = null
  const flyer = new ElytraFlyer(bot, new HotbarLoadout(bot, {}), silent, {})
  assert.equal(await flyer.boost(), false)
})

test('flyTo mengarahkan pandangan dan boost hanya bila lambat', async () => {
  const bot = fakeBot()
  const flyer = new ElytraFlyer(bot, new HotbarLoadout(bot, {}), silent, { boostSpeed: 0.6 })
  bot.entity.velocity = new Vec3(1.2, 0, 0)
  await flyer.flyTo(new Vec3(40, 70, 0))
  assert.equal(bot.looks.length, 1)
  assert.equal(bot.activations, 0, 'kecepatan cukup, tidak perlu firework')

  bot.entity.velocity = new Vec3(0.1, 0, 0)
  await flyer.flyTo(new Vec3(40, 70, 0))
  assert.equal(bot.activations, 1, 'lambat, pakai firework')
})

test('chargeAttack membidik titik tangensial lalu attack', async () => {
  const bot = fakeBot()
  const flyer = new ElytraFlyer(bot, new HotbarLoadout(bot, {}), silent, {})
  const t = { position: new Vec3(20, 70, 0), velocity: new Vec3(0, 0, 0), height: 1.8 }
  const r = await flyer.chargeAttack(t)
  assert.equal(r.ok, true)
  assert.equal(bot.attacks.length, 1)
  assert.ok(bot.looks[0].z > 2, 'bidik melewati samping target, bukan lurus')
})

test('chargeAttack menolak target di deadzone', async () => {
  const bot = fakeBot()
  const flyer = new ElytraFlyer(bot, new HotbarLoadout(bot, {}), silent, {})
  const t = { position: new Vec3(2.5, 70, 0), velocity: new Vec3(0, 0, 0), height: 1.8 }
  const r = await flyer.chargeAttack(t)
  assert.equal(r.ok, false)
  assert.equal(bot.attacks.length, 0)
})

test('land memasang kembali chestplate', async () => {
  const bot = fakeBot()
  const flyer = new ElytraFlyer(bot, new HotbarLoadout(bot, {}), silent, {})
  await flyer.takeOff()
  await flyer.land()
  const names = bot.equipCalls.map(c => c[0])
  assert.deepEqual(names, ['elytra', 'netherite_chestplate'])
})
