'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('events')
const Vec3 = require('vec3')
const { MaceSmasher } = require('../src/combat/mace')
const { HotbarLoadout } = require('../src/combat/loadout')

const silent = { info () {}, debug () {}, warn () {}, error () {} }

// Bot palsu yang meniru cara mineflayer benar-benar mengirim rotasi:
// bot.look() hanya mengubah state lokal, sedangkan paket rotation dikirim oleh
// updatePosition() pada setiap physicsTick dari lastSentYaw/lastSentPitch.
// Uji ini meniru urutan itu supaya bug "wind charge tidak jatuh ke bawah"
// (paket use_item memakai rotasi lama) benar-benar tertangkap.
function fakeBot ({ onGround = true, withLook = true } = {}) {
  const bot = new EventEmitter()
  const slots = new Array(46).fill(null)
  const start = [
    { name: 'mace', count: 1 },
    { name: 'wind_charge', count: 8 },
    { name: 'water_bucket', count: 1 }
  ]
  start.forEach((it, i) => { slots[36 + i] = it })
  bot.inventory = { slots, items: () => slots.filter(Boolean) }
  bot.moveSlotItem = async (from, to) => { const t = slots[to]; slots[to] = slots[from]; slots[from] = t }
  bot.equip = async () => {}
  bot.setQuickBarSlot = i => { bot.quickBar = i }
  bot.entity = { position: new Vec3(0, 64, 0), velocity: new Vec3(0, 0, 0), onGround, id: 1, yaw: 0, pitch: 0, eyeHeight: 1.62 }
  bot.controls = {}
  bot.setControlState = (k, v) => { bot.controls[k] = v }
  bot.lookAtIfPresent = async point => {
    const delta = point.minus(bot.entity.position.offset(0, bot.entity.eyeHeight, 0))
    const yaw = Math.atan2(-delta.x, -delta.z)
    const pitch = Math.atan2(delta.y, Math.hypot(delta.x, delta.z))
    await bot.look(yaw, pitch, true)
  }
  bot.lookAt = async point => {
    if (!withLook) return bot.lookAtIfPresent(point)
    return bot.lookAtIfPresent(point)
  }
  bot.look = async (yaw, pitch, force) => {
    bot.entity.yaw = yaw
    bot.entity.pitch = pitch
    bot.lastSentYaw = yaw
    bot.lastSentPitch = pitch
    bot.lookCalls.push([yaw, pitch, force === true])
  }
  bot.lookCalls = []
  // Simulasi paket use_item: rotasi yang dikirim adalah rotasi terakhir yang
  // benar-benar sampai ke server, bukan rotasi lokal.
  bot.sentRotations = []
  bot.activations = 0
  bot.activateItem = () => {
    bot.activations++
    bot.sentRotations.push({ yaw: bot.serverYaw, pitch: bot.serverPitch })
    bot.entity.onGround = false
    bot.entity.velocity = new Vec3(0, 0.8, 0)
  }
  bot.serverYaw = 0
  bot.serverPitch = 0
  bot.physicsTick = () => {
    if (bot.lastSentYaw !== undefined) bot.serverYaw = bot.lastSentYaw
    if (bot.lastSentPitch !== undefined) bot.serverPitch = bot.lastSentPitch
  }
  bot.on('physicsTick', () => bot.physicsTick())
  bot.attacks = []
  bot.attack = e => bot.attacks.push(e)
  bot.deactivateItem = () => {}
  bot.blockAt = () => ({ name: 'grass_block', position: new Vec3(0, 63, 0) })
  bot._client = { write () {} }
  return bot
}

const target = () => ({ position: new Vec3(0, 64, 6), velocity: new Vec3(0, 0, 0), height: 1.8 })

async function drive (bot, promise, ticks = 60) {
  let done = false
  promise.then(() => { done = true }, () => { done = true })
  for (let i = 0; i < ticks && !done; i++) {
    await new Promise(resolve => setTimeout(resolve, 6))
    bot.emit('physicsTick')
  }
  return promise
}

test('launch: wind charge dipakai setelah rotasi ke bawah sampai ke server', async () => {
  const bot = fakeBot()
  const mace = new MaceSmasher(bot, new HotbarLoadout(bot, {}), silent, { rotationTicks: 2 })
  await drive(bot, mace.launch(target()))

  assert.equal(bot.activations, 1)
  const raked = bot.sentRotations[0]
  assert.ok(Math.abs(raked.pitch - (-Math.PI / 2)) < 0.05,
    `wind charge harus dilempar dengan pitch -90 derajat, terkirim ${raked.pitch}`)
})

test('launch: lompat sebelum pelemparan supaya charge meledak di bawah kaki', async () => {
  const bot = fakeBot()
  const order = []
  const control = bot.setControlState
  bot.setControlState = (key, value) => { if (key === 'jump') order.push(`jump:${value}`); control(key, value) }
  const mace = new MaceSmasher(bot, new HotbarLoadout(bot, {}), silent, { rotationTicks: 2 })
  await drive(bot, mace.launch(target()))
  assert.deepEqual(order.slice(0, 2), ['jump:true', 'jump:false'])
  assert.equal(bot.activations, 1)
})

test('launch: pitch dipulihkan ke target, bukan tertinggal menatap ke bawah', async () => {
  const bot = fakeBot()
  const mace = new MaceSmasher(bot, new HotbarLoadout(bot, {}), silent, { rotationTicks: 2 })
  await drive(bot, mace.launch(target()), 6)
  assert.ok(bot.lookCalls.length >= 1)
})

test('hasWindBurst mengenali enchant wind_burst pada mace', async () => {
  const bot = fakeBot()
  const loadout = new HotbarLoadout(bot, {})
  const mace = new MaceSmasher(bot, loadout, silent, {})
  assert.equal(mace.hasWindBurst(), false, 'mace tanpa enchant')
  const real = loadout.item
  loadout.item = tag => (tag === 'mace'
    ? { name: 'mace', enchants: [{ name: 'wind_burst' }] }
    : real.call(loadout, tag))
  assert.equal(mace.hasWindBurst(), true, 'mace dengan Wind Burst')
})
