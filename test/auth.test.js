'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('events')
const { AuthManager } = require('../src/auth')

function authConfig (overrides = {}) {
  return {
    enabled: true,
    password: 'rahasia',
    registerCommand: '/register {password} {password}',
    loginCommand: '/login {password}',
    registerPatterns: ['register'],
    loginPatterns: ['login'],
    alreadyRegisteredPatterns: ['already registered'],
    loggedInPatterns: ['successfully logged in'],
    proactiveLogin: false,
    proactiveLoginDelayMs: 3000,
    attemptDelayMs: 50,
    maxAttempts: 6,
    ...overrides
  }
}

function fakeBot () {
  const bot = new EventEmitter()
  const sent = []
  bot.username = 'BuilderBot'
  bot.chat = message => sent.push(message)
  return { bot, sent }
}

const silentLogger = {
  info () {},
  warn () {},
  error () {},
  debug () {}
}

test('forceRegister sends the configured register command again', t => {
  const { bot, sent } = fakeBot()
  const auth = new AuthManager(bot, authConfig(), silentLogger)
  t.after(() => auth.stop())

  auth.attempts = 6
  auth.registerAttempts = 3
  auth.lastAttemptAt = Date.now()

  assert.equal(auth.forceRegister(), true)
  assert.deepEqual(sent, ['/register rahasia rahasia'])
  assert.equal(auth.attempts, 1)
  assert.equal(auth.state, 'waiting')
})

test('forceRegister is ignored while register is already in progress', t => {
  const { bot, sent } = fakeBot()
  const auth = new AuthManager(bot, authConfig(), silentLogger)
  t.after(() => auth.stop())

  auth.state = 'registering'
  assert.equal(auth.forceRegister(), false)
  assert.deepEqual(sent, [])
})

test('forceRegister is ignored when auth is disabled', t => {
  const { bot, sent } = fakeBot()
  const auth = new AuthManager(bot, authConfig({ enabled: false }), silentLogger)
  t.after(() => auth.stop())

  assert.equal(auth.forceRegister(), false)
  assert.deepEqual(sent, [])
})
