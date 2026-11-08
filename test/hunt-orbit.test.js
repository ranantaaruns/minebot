'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('events')
const Vec3 = require('vec3')
const { PlayerHunter } = require('../src/safety/hunt')

const silent = { info () {}, debug () {}, warn () {}, error () {} }

function cfg (hunt = {}) {
  return { combat: { hunt } }
}

function fakeBot (position = new Vec3(0, 64, 0)) {
  const bot = new EventEmitter()
  bot.entity = { position, velocity: new Vec3(0, 0, 0), onGround: true, id: 1 }
  bot.inventory = { items: () => [{ name: 'diamond_sword', count: 1 }], slots: [] }
  bot.controls = {}
  bot.setControlState = (key, value) => { bot.controls[key] = value }
  bot.lookAt = async () => {}
  bot.equip = async () => {}
  bot.attack = () => {}
  bot.pathfinder = { setGoal: () => {}, stop: () => {}, setMovements: () => {} }
  bot.blockAt = () => ({ name: 'air' })
  return bot
}

function enemy (x = 0, y = 64, z = 3) {
  return { id: 9, username: 'Musuh', position: new Vec3(x, y, z), velocity: new Vec3(0, 0, 0), height: 1.8, health: 20 }
}

test('orbit aktif di jarak melee: strafe sambil tetap menghadap lawan', async () => {
  const bot = fakeBot()
  const hunter = new PlayerHunter(bot, cfg(), silent)
  const target = enemy()
  let looked = false
  bot.lookAt = async () => { looked = true }

  const active = await hunter._orbit(target)
  assert.equal(active, true)
  assert.equal(looked, true, 'bot tetap membidik lawan')
  assert.equal(bot.controls.right === true || bot.controls.left === true, true, 'ada strafe lateral')
})

test('orbit menjaga jarak: maju kalau terlalu jauh, mundur kalau terlalu dekat', async () => {
  const bot = fakeBot()
  const hunter = new PlayerHunter(bot, cfg(), silent)

  await hunter._orbit(enemy(0, 64, 4))
  assert.equal(bot.controls.forward, true, 'jarak 4 > radius, bot maju sambil strafe')

  await hunter._orbit(enemy(0, 64, 1.2))
  assert.equal(bot.controls.back, true, 'jarak 1.2 terlalu dekat, bot mundur')
  assert.equal(bot.controls.forward, false)
})

test('orbit tidak aktif saat target jauh (pathfinder yang bekerja)', async () => {
  const bot = fakeBot()
  const hunter = new PlayerHunter(bot, cfg(), silent)
  assert.equal(await hunter._orbit(enemy(0, 64, 30)), false)
})

test('orbit berhenti saat bot sedang makan supaya consume tidak batal', async () => {
  const bot = fakeBot()
  bot.foodManager = { eating: true }
  const hunter = new PlayerHunter(bot, cfg(), silent)
  assert.equal(await hunter._orbit(enemy()), false)
  assert.equal(bot.controls.right, undefined)
})

test('orbit berganti arah setelah orbitFlipMs', async () => {
  const bot = fakeBot()
  const hunter = new PlayerHunter(bot, cfg({ orbitFlipMs: 10 }), silent)
  const target = enemy()
  await hunter._orbit(target)
  const first = hunter._orbitSide
  await new Promise(resolve => setTimeout(resolve, 25))
  await hunter._orbit(target)
  assert.notEqual(hunter._orbitSide, first, 'arah putaran dibalik agar tidak mudah ditebak')
})

test('stopOrbit melepas semua tombol gerak', async () => {
  const bot = fakeBot()
  const hunter = new PlayerHunter(bot, cfg(), silent)
  await hunter._orbit(enemy())
  hunter._stopOrbit()
  assert.equal(bot.controls.forward, false)
  assert.equal(bot.controls.back, false)
  assert.equal(bot.controls.left, false)
  assert.equal(bot.controls.right, false)
})

test('orbitEnabled=false mematikan orbit', async () => {
  const bot = fakeBot()
  const hunter = new PlayerHunter(bot, cfg({ orbitEnabled: false }), silent)
  assert.equal(await hunter._orbit(enemy()), false)
})
