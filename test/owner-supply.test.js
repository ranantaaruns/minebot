'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('events')
const mcData = require('minecraft-data')('1.21.4')
const { waitForOwnerSupply } = require('../src/materials/owner-supply')
const { Cancellation, CancelledError } = require('../src/util/async')

const silentLogger = {
  info () {},
  warn () {},
  debug () {},
  error () {}
}

function fakeBot () {
  const bot = new EventEmitter()
  bot.entity = { position: { x: 0, y: 64, z: 0, distanceTo: () => 0 } }
  bot.entities = {}
  bot.inventory = { items: () => [] }
  bot.sent = []
  bot.whisper = (username, message) => bot.sent.push([username, message])
  bot.chat = message => bot.sent.push(message)
  return bot
}

test('waitForOwnerSupply stops when the owner says stop', async () => {
  const bot = fakeBot()
  const cancellation = new Cancellation()
  const waiting = waitForOwnerSupply(bot, mcData, 'cherry_stairs', 4, {
    config: { owner: { username: 'Owner' }, gather: { clearChestObstructions: false } },
    logger: silentLogger,
    cancellation,
    reminderMs: 60000,
    pickupRadius: 8,
    preferChests: false
  })

  await new Promise(resolve => setImmediate(resolve))
  assert.ok(bot.sent.some(([, message]) => /cherry_stairs/.test(message)))
  bot.emit('chat', 'Owner', 'stop')

  await assert.rejects(waiting, err => {
    assert.ok(err instanceof CancelledError)
    assert.match(err.message, /owner/i)
    return true
  })
})
