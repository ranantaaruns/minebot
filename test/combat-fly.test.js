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

test('engage menahan use item dengan spear (status charged)', async () => {
  const bot = fakeBot()
  const flyer = new ElytraFlyer(bot, new HotbarLoadout(bot, {}), silent, {})
  assert.equal(await flyer.engage(), true)
  assert.equal(bot.activations, 1)
  assert.equal(flyer.engaged, true)
  assert.equal(await flyer.engage(), true)
  assert.equal(bot.activations, 1, 'tidak dobel activate')
})

test('release melepas use item', async () => {
  const bot = fakeBot()
  let releases = 0
  bot.deactivateItem = () => { releases++ }
  const flyer = new ElytraFlyer(bot, new HotbarLoadout(bot, {}), silent, {})
  await flyer.engage()
  flyer.release()
  assert.equal(releases, 1)
  assert.equal(flyer.engaged, false)
})

test('climbAway memakai pitch -15 derajat', async () => {
  const bot = fakeBot()
  bot.look = async (yaw, pitch) => { bot.pitchCall = [yaw, pitch] }
  const flyer = new ElytraFlyer(bot, new HotbarLoadout(bot, {}), silent, {})
  flyer.climbAway()
  await new Promise(r => setTimeout(r, 2))
  assert.ok(Math.abs(bot.pitchCall[1] - (-15 * Math.PI / 180)) < 1e-6)
})

test('chargeAttack mempertahankan status engaged sebelum menyapu target', async () => {
  const bot = fakeBot()
  const flyer = new ElytraFlyer(bot, new HotbarLoadout(bot, {}), silent, {})
  const t = { position: new Vec3(20, 70, 0), velocity: new Vec3(0, 0, 0), height: 1.8 }
  await flyer.chargeAttack(t)
  assert.equal(flyer.engaged, true)
  assert.equal(bot.activations, 1)
})

test('land memasang kembali chestplate', async () => {
  const bot = fakeBot()
  const flyer = new ElytraFlyer(bot, new HotbarLoadout(bot, {}), silent, {})
  await flyer.takeOff()
  await flyer.land()
  const names = bot.equipCalls.map(c => c[0])
  assert.deepEqual(names, ['elytra', 'netherite_chestplate'])
})

test('attackRun membuka elytra dulu saat masih di tanah', async () => {
  const bot = fakeBot()
  const flyer = new ElytraFlyer(bot, new HotbarLoadout(bot, {}), silent, { runupDistance: 12 })
  const t = { position: new Vec3(10, 70, 0), velocity: new Vec3(0, 0, 0), height: 1.8 }
  const p = flyer.attackRun(t)
  await new Promise(r => setTimeout(r, 5))
  bot.emit('physicsTick')
  await new Promise(r => setTimeout(r, 5))
  bot.emit('physicsTick')
  const result = await p
  assert.equal(result.phase, 'takeoff')
  assert.equal(bot.equipCalls[0][0], 'elytra')
  assert.equal(flyer.stats.takeoffs, 1)
  assert.equal(bot.attacks.length, 0)
})

test('attackRun menjauh dan memakai firework untuk mengumpulkan kecepatan', async () => {
  const bot = fakeBot()
  const flyer = new ElytraFlyer(bot, new HotbarLoadout(bot, {}), silent, { runupDistance: 12, attackSpeed: 1.2 })
  bot.entity.onGround = false
  bot.entity.elytraFlying = true
  bot.entity.position = new Vec3(0, 74, 0)
  bot.entity.velocity = new Vec3(0.1, 0, 0)
  const t = { position: new Vec3(8, 70, 0), velocity: new Vec3(0, 0, 0), height: 1.8 }
  const result = await flyer.attackRun(t)
  assert.equal(result.phase, 'runup')
  assert.ok(bot.looks[0].x < -5, 'titik run-up berada di belakang bot, menjauh dari target')
  assert.equal(bot.activations, 1, 'firework dipakai karena masih lambat')
  assert.equal(bot.attacks.length, 0, 'belum menyerang saat kecepatan kurang')
})

test('attackRun menyerang saat kecepatan dan jarak memenuhi syarat', async () => {
  const bot = fakeBot()
  const flyer = new ElytraFlyer(bot, new HotbarLoadout(bot, {}), silent, { runupDistance: 12, attackSpeed: 1 })
  flyer.phase = 'strike'
  bot.entity.onGround = false
  bot.entity.elytraFlying = true
  bot.entity.position = new Vec3(0, 74, 0)
  bot.entity.velocity = new Vec3(1.4, 0, 0)
  const t = { position: new Vec3(3, 73, 0), velocity: new Vec3(0, 0, 0), height: 1.8 }
  const result = await flyer.attackRun(t)
  assert.equal(result.ok, true)
  assert.equal(bot.attacks.length, 1)
  assert.equal(flyer.engaged, true)
})

test('flyTo menghindari blok di depan dengan menaikkan titik terbang', async () => {
  const bot = fakeBot()
  const flyer = new ElytraFlyer(bot, new HotbarLoadout(bot, {}), silent, { avoidance: true })
  bot.entity.onGround = false
  bot.entity.elytraFlying = true
  bot.entity.position = new Vec3(0, 74, 0)
  bot.entity.velocity = new Vec3(1, 0, 0)
  bot.blockAt = p => (p.x > 1 && p.x < 3 && p.y <= 76 ? { name: 'stone' } : { name: 'air' })
  await flyer.flyTo(new Vec3(20, 74, 0))
  assert.ok(bot.looks[0].y > 76, 'pandangan diarahkan ke atas untuk melewati tembok')
  assert.equal(flyer.stats.avoidances, 1)
})

test('attackRun berbalik menuju target setelah run-up dan kecepatan cukup', async () => {
  const bot = fakeBot()
  const flyer = new ElytraFlyer(bot, new HotbarLoadout(bot, {}), silent, { runupDistance: 12, attackSpeed: 1 })
  bot.entity.onGround = false
  bot.entity.elytraFlying = true
  bot.entity.position = new Vec3(0, 74, 0)
  bot.entity.velocity = new Vec3(1.4, 0, 0)
  const target = { position: new Vec3(14, 70, 0), velocity: new Vec3(0, 0, 0), height: 1.8 }
  const result = await flyer.attackRun(target)
  assert.equal(result.phase, 'strike')
  assert.ok(bot.looks.at(-1).x > 0, 'setelah run-up bot terbang ke target, bukan terus menjauh')
  assert.equal(bot.attacks.length, 0, 'masih di luar jangkauan hit')
})

test('strike memakai kecepatan relatif terhadap target', async () => {
  const bot = fakeBot()
  const flyer = new ElytraFlyer(bot, new HotbarLoadout(bot, {}), silent, { attackSpeed: 1, minStrikeSpeed: 0.9 })
  flyer.phase = 'strike'
  bot.entity.onGround = false
  bot.entity.elytraFlying = true
  bot.entity.position = new Vec3(0, 74, 0)
  bot.entity.velocity = new Vec3(1.4, 0, 0)
  const target = { position: new Vec3(3, 73, 0), velocity: new Vec3(1.4, 0, 0), height: 1.8 }
  const result = await flyer.attackRun(target)
  assert.equal(bot.attacks.length, 0, 'target secepat bot membuat kecepatan relatif nol')
  assert.notEqual(result.ok, true)
})
