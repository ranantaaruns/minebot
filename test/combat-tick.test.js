'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('events')
const { nextTick, fallFlyingActionId, startGlide } = require('../src/combat/tick')

function fakeBot () {
  const bot = new EventEmitter()
  bot.entity = { id: 7, onGround: false }
  bot.controlStates = {}
  bot.setControlState = (k, v) => { bot.controlStates[k] = v }
  bot.writes = []
  bot._client = { write: (name, payload) => bot.writes.push({ name, payload }) }
  return bot
}

test('nextTick selesai setelah N physicsTick', async () => {
  const bot = fakeBot()
  let done = false
  const p = nextTick(bot, 2).then(() => { done = true })
  bot.emit('physicsTick')
  await Promise.resolve()
  assert.equal(done, false, 'belum boleh selesai setelah 1 tick')
  bot.emit('physicsTick')
  await p
  assert.equal(done, true)
})

test('nextTick tidak menggantung tanpa event', async () => {
  const bot = fakeBot()
  const t0 = Date.now()
  await nextTick(bot, 1, 60)
  assert.ok(Date.now() - t0 < 1000, 'harus keluar lewat jaring pengaman')
})

test('fallFlyingActionId membaca 8 dari minecraft-data 1.21.4', () => {
  const mcData = require('minecraft-data')('1.21.4')
  assert.equal(fallFlyingActionId(mcData), 8)
})

test('fallFlyingActionId punya fallback 8 tanpa mcData', () => {
  assert.equal(fallFlyingActionId(null), 8)
})

test('startGlide mengirim entity_action start_fall_flying', () => {
  const bot = fakeBot()
  const mcData = require('minecraft-data')('1.21.4')
  const ok = startGlide(bot, mcData)
  assert.equal(ok, true)
  assert.equal(bot.writes.length, 1)
  assert.equal(bot.writes[0].name, 'entity_action')
  assert.equal(bot.writes[0].payload.actionId, 8)
  assert.equal(bot.writes[0].payload.entityId, 7)
})

test('startGlide fallback ke lompat ganda bila packet gagal', () => {
  const bot = fakeBot()
  bot._client = { write: () => { throw new Error('unknown packet') } }
  const ok = startGlide(bot, null)
  assert.equal(ok, false)
  assert.equal(bot.controlStates.jump, false)
})

test('fallFlyingActionId membaca 6 dari minecraft-data 1.21.11', () => {
  const mcData = require('minecraft-data')('1.21.11')
  assert.equal(fallFlyingActionId(mcData), 6)
})

test('actionId 1.21.11 sama dengan encoding nama start_fall_flying', () => {
  const { createSerializer } = require('minecraft-protocol')
  const mcData = require('minecraft-data')('1.21.11')
  const ser = createSerializer({ state: 'play', isServer: false, version: '1.21.11' })
  const enc = actionId => ser.createPacketBuffer({
    name: 'entity_action',
    params: { entityId: 7, actionId, jumpBoost: 0 }
  }).toString('hex')

  // Menulis 8 (angka yang dipakai bot.elytraFly bawaan mineflayer) menghasilkan
  // paket berbeda, artinya id harus dibaca dari data versi server.
  assert.notEqual(enc(8), enc('start_fall_flying'))
  assert.equal(enc(fallFlyingActionId(mcData)), enc('start_fall_flying'))
})

test('startGlide mengirim actionId sesuai versi server 1.21.11', () => {
  const bot = fakeBot()
  const mcData = require('minecraft-data')('1.21.11')
  assert.equal(startGlide(bot, mcData), true)
  assert.equal(bot.writes[0].payload.actionId, 6)
})
