'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const EventEmitter = require('events')
const {
  GamemodeManager,
  normalizeGamemode,
  fillGamemodeCommand
} = require('../src/gamemode')

function createMockBot (initialMode = 'survival') {
  const bot = new EventEmitter()
  bot.username = 'BuilderBot'
  bot.game = { gameMode: initialMode }
  bot.sent = []
  bot.chat = message => {
    bot.sent.push(message)
  }
  return bot
}

test('normalizeGamemode converts aliases and numbers to standard mode names', () => {
  assert.equal(normalizeGamemode('0'), 'survival')
  assert.equal(normalizeGamemode('s'), 'survival')
  assert.equal(normalizeGamemode('SURVIVAL'), 'survival')
  assert.equal(normalizeGamemode('1'), 'creative')
  assert.equal(normalizeGamemode('c'), 'creative')
  assert.equal(normalizeGamemode('creative'), 'creative')
  assert.equal(normalizeGamemode('2'), 'adventure')
  assert.equal(normalizeGamemode('a'), 'adventure')
  assert.equal(normalizeGamemode('3'), 'spectator')
  assert.equal(normalizeGamemode('sp'), 'spectator')
  assert.equal(normalizeGamemode('invalid'), null)
  assert.equal(normalizeGamemode(null), null)
})

test('fillGamemodeCommand substitutes mode and username placeholders', () => {
  assert.equal(fillGamemodeCommand('/gamemode {mode}', 'creative', 'Bot1'), '/gamemode creative')
  assert.equal(
    fillGamemodeCommand('/gamemode {mode} {username}', 'survival', 'Bot1'),
    '/gamemode survival Bot1'
  )
})

test('GamemodeManager tracks current mode and isCreative flag', () => {
  const bot = createMockBot('creative')
  const gm = new GamemodeManager(bot, {}, null)

  assert.equal(gm.currentMode, 'creative')
  assert.equal(gm.isCreative(), true)

  bot.game.gameMode = 'survival'
  assert.equal(gm.currentMode, 'survival')
  assert.equal(gm.isCreative(), false)
})

test('GamemodeManager setGamemode resolves immediately if already in target mode', async () => {
  const bot = createMockBot('creative')
  const gm = new GamemodeManager(bot, {}, null)

  const res = await gm.setGamemode('creative')
  assert.equal(res.ok, true)
  assert.equal(res.already, true)
  assert.equal(bot.sent.length, 0)
})

test('GamemodeManager setGamemode sends command and resolves upon game event', async () => {
  const bot = createMockBot('survival')
  const gm = new GamemodeManager(bot, { command: '/gamemode {mode}' }, null)

  const promise = gm.setGamemode('creative', { timeoutMs: 1000 })
  assert.deepEqual(bot.sent, ['/gamemode creative'])

  // Simulate server sending game mode update packet
  bot.game.gameMode = 'creative'
  bot.emit('game')

  const res = await promise
  assert.equal(res.ok, true)
  assert.equal(res.mode, 'creative')
  assert.equal(res.previousMode, 'survival')
})

test('GamemodeManager setGamemode handles timeout when server ignores command', async () => {
  const bot = createMockBot('survival')
  const gm = new GamemodeManager(bot, { command: '/gamemode {mode}' }, null)

  const res = await gm.setGamemode('creative', { timeoutMs: 50 })
  assert.equal(res.ok, false)
  assert.equal(res.mode, 'survival')
  assert.match(res.error, /timeout/i)
})

test('GamemodeManager restoreGamemode switches back to previous mode', async () => {
  const bot = createMockBot('survival')
  const gm = new GamemodeManager(bot, {}, null)

  const switchPromise = gm.setGamemode('creative', { timeoutMs: 500 })
  bot.game.gameMode = 'creative'
  bot.emit('game')
  await switchPromise

  assert.equal(gm.previousMode, 'survival')

  const restorePromise = gm.restoreGamemode({ timeoutMs: 500 })
  assert.deepEqual(bot.sent, ['/gamemode creative', '/gamemode survival'])

  bot.game.gameMode = 'survival'
  bot.emit('game')
  const restoreRes = await restorePromise

  assert.equal(restoreRes.ok, true)
  assert.equal(restoreRes.mode, 'survival')
  assert.equal(gm.previousMode, null)
})
