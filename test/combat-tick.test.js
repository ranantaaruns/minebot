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
