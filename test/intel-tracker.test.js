'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { EventEmitter } = require('events')
const Vec3 = require('vec3')
const { PlayerTracker } = require('../src/intel/tracker')

const silentLogger = { info () {}, warn () {}, debug () {}, error () {}, chat () {} }

function fakeBot () {
  const bot = new EventEmitter()
  bot.username = 'BotA'
  bot.entity = { id: 1, position: new Vec3(0, 64, 0) }
  bot.game = { dimension: 'minecraft:overworld' }
  bot._chats = []
  bot.chat = message => bot._chats.push(message)
  return bot
}

function player (name, x, z, id = 9) {
  return { id, type: 'player', username: name, uuid: `uuid-${name}`, position: new Vec3(x, 64, z) }
}

function tracker (bot, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-track-'))
  return new PlayerTracker(bot, { intel: { tracker: { dir, saveDebounceMs: 10, ...options } } }, silentLogger)
}

test('mencatat sampel pemain lain, bukan diri sendiri', () => {
  const bot = fakeBot()
  const t = tracker(bot)
  t.start()
  bot.emit('entityMoved', player('BotA', 5, 5, 1))
  bot.emit('entityMoved', player('Steve', 10, -4))
  assert.equal(t.players.has('BotA'), false)
  const record = t.players.get('Steve')
  assert.equal(record.samples.length, 1)
  assert.equal(t.stats.samples, 1)
  t.stop()
})

test('riwayat dibatasi historyLength', () => {
  const bot = fakeBot()
  const t = tracker(bot, { historyLength: 3 })
  t.start()
  for (let i = 0; i < 6; i++) bot.emit('entityMoved', player('Steve', i, 0))
  assert.equal(t.players.get('Steve').samples.length, 3)
  t.stop()
})

test('where menampilkan jarak, arah, dan status basi', () => {
  const bot = fakeBot()
  const t = tracker(bot)
  t.start()
  bot.emit('entityMoved', player('Steve', 10, 0))
  const info = t.where('Steve')
  assert.equal(info.distance, 10)
  assert.equal(info.bearing, 90)
  assert.equal(info.stale, false)
  assert.match(info.coords, /^10\.0 64\.0 0\.0$/)
  t.stop()
})

test('where memberi prediksi setelah melewati staleMs', () => {
  const bot = fakeBot()
  const t = tracker(bot)
  t.start()
  bot.emit('entityMoved', player('Steve', 0, 0))
  t.players.get('Steve').lastSeen = Date.now() - 60000
  const info = t.where('Steve')
  assert.equal(info.stale, true)
  assert.ok(info.prediction)
  t.stop()
})

test('entityGone menandai hilang tanpa menghapus riwayat', () => {
  const bot = fakeBot()
  const t = tracker(bot)
  t.start()
  bot.emit('entityMoved', player('Steve', 1, 1))
  bot.emit('entityGone', player('Steve', 1, 1))
  const record = t.players.get('Steve')
  assert.equal(record.gone, true)
  assert.equal(record.samples.length, 1)
  t.stop()
})

test('alert radius memicu log dan chat bila diminta', () => {
  const bot = fakeBot()
  const warnings = []
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-track-'))
  const t = new PlayerTracker(bot, { intel: { tracker: { dir, saveDebounceMs: 10, alertRadius: 16, alertChat: true } } }, { ...silentLogger, warn: m => warnings.push(m) })
  t.start()
  bot.emit('entityMoved', player('Steve', 8, 0))
  assert.equal(warnings.length, 1)
  assert.equal(bot._chats.length, 1)
  assert.equal(t.stats.alerts, 1)
  t.stop()
})

test('enabled false mengabaikan event', () => {
  const bot = fakeBot()
  const t = tracker(bot, { enabled: false })
  t.start()
  bot.emit('entityMoved', player('Steve', 1, 0))
  assert.equal(t.players.size, 0)
  t.stop()
})

test('start memuat file yang sudah ada', async () => {
  const bot = fakeBot()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-track-'))
  const t = new PlayerTracker(bot, { intel: { tracker: { dir } } }, silentLogger)
  fs.mkdirSync(path.dirname(t.store.file), { recursive: true })
  fs.writeFileSync(t.store.file, JSON.stringify({ version: 1, players: { Alex: { uuid: 'u', samples: [{ t: 1, x: 1, y: 64, z: 1 }] } } }), 'utf8')
  await t.start()
  assert.ok(t.where('Alex'))
  t.stop()
})

test('export menyalin semua record ke file', async () => {
  const bot = fakeBot()
  const t = tracker(bot)
  t.start()
  bot.emit('entityMoved', player('Steve', 2, 2))
  const target = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-export-')), 'out.json')
  await t.exportTo(target)
  const parsed = JSON.parse(fs.readFileSync(target, 'utf8'))
  assert.equal(parsed.players.Steve.samples.length, 1)
  t.stop()
})
