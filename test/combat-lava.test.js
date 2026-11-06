'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('events')
const Vec3 = require('vec3')
const { LavaBucketAttack, isLavaBlock } = require('../src/combat/lava')

const silent = { info () {}, debug () {}, warn () {}, error () {} }

function fakeBot ({ pickupFailures = 0, rejectPlacement = false } = {}) {
  const bot = new EventEmitter()
  const lavaBucket = { name: 'lava_bucket', count: 1, type: 1 }
  const emptyBucket = { name: 'bucket', count: 1, type: 2 }
  const sword = { name: 'diamond_sword', count: 1, type: 3 }
  const items = [lavaBucket, sword]
  bot.inventory = { items: () => items.filter(item => item.count > 0) }
  bot.entity = { position: new Vec3(0, 64, 0) }
  bot.heldItem = null
  bot.equip = async item => { bot.heldItem = item }
  bot.lookAt = async point => { bot.lookPoint = point }
  bot.source = new Vec3(3, 64, 0)
  bot.placed = 0
  bot.pickups = 0
  bot.blockAt = point => {
    if (point.x === 3 && point.y === 63 && point.z === 0) return { name: 'stone', boundingBox: 'block', position: point }
    if (bot.placed && point.x === 3 && point.y === 64 && point.z === 0) return { name: 'lava', position: point }
    return { name: 'air', boundingBox: 'empty', position: point }
  }
  const use = () => {
    if (bot.heldItem?.name === 'lava_bucket' && !bot.placed) {
      if (rejectPlacement) return
      bot.placed++
      lavaBucket.count = 0
      if (!items.includes(emptyBucket)) items.push(emptyBucket)
      emptyBucket.count = 1
      bot.heldItem = emptyBucket
      return
    }
    if (bot.heldItem?.name === 'bucket' && bot.placed) {
      bot.pickups++
      if (bot.pickups <= pickupFailures) return
      bot.placed = 0
      emptyBucket.count = 0
      lavaBucket.count = 1
      bot.heldItem = lavaBucket
    }
  }
  bot.activateBlock = async () => use()
  bot.activateItem = () => use()
  return bot
}

async function drive (bot, promise, ticks = 24) {
  for (let i = 0; i < ticks; i++) {
    await new Promise(resolve => setTimeout(resolve, 2))
    bot.emit('physicsTick')
  }
  return promise
}

const target = () => ({ position: new Vec3(3.2, 64, 0), height: 1.8 })

test('isLavaBlock mengenali lava sumber dan flowing', () => {
  assert.equal(isLavaBlock({ name: 'lava' }), true)
  assert.equal(isLavaBlock({ name: 'minecraft:flowing_lava' }), true)
  assert.equal(isLavaBlock({ name: 'water' }), false)
})

test('lava ditaruh di kaki lawan lalu sumber dan lava bucket diambil kembali', async () => {
  const bot = fakeBot()
  const lava = new LavaBucketAttack(bot, silent, { burnTicks: 3 })
  const result = await drive(bot, lava.tryAttack(target()))
  assert.equal(result, true)
  assert.equal(bot.placed, 0, 'blok lava sudah diambil')
  assert.equal(bot.inventory.items().filter(item => item.name === 'lava_bucket').length, 1)
  assert.equal(lava.stats.uses, 1)
  assert.equal(lava.stats.recoveries, 1)
  assert.equal(lava.activeSource, null)
})

test('pickup yang gagal dicoba ulang sampai bucket benar-benar kembali', async () => {
  const bot = fakeBot({ pickupFailures: 1 })
  const lava = new LavaBucketAttack(bot, silent, { burnTicks: 2, pickupAttempts: 3 })
  const result = await drive(bot, lava.tryAttack(target()))
  assert.equal(result, true)
  assert.equal(bot.pickups, 2)
  assert.equal(bot.placed, 0)
})

test('lava tidak ditaruh terlalu dekat dengan bot sendiri', async () => {
  const bot = fakeBot()
  const lava = new LavaBucketAttack(bot, silent, {})
  assert.equal(await lava.tryAttack({ position: new Vec3(1, 64, 0) }), false)
  assert.equal(bot.placed, 0)
})

test('penempatan yang ditolak server tidak dihitung sebagai serangan', async () => {
  const bot = fakeBot({ rejectPlacement: true })
  const lava = new LavaBucketAttack(bot, silent, {})
  const result = await drive(bot, lava.tryAttack(target()), 6)
  assert.equal(result, false)
  assert.equal(lava.stats.uses, 0)
  assert.equal(lava.activeSource, null)
})
