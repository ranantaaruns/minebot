'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { Cli } = require('../src/cli')

const silentLogger = { info () {}, warn () {}, error () {}, debug () {}, chat () {} }

function engine (enabled = true) {
  return { enabled, stats: { launches: 2, smashes: 3, charges: 1, clutch: 0 } }
}

test('combat tanpa argumen hanya melaporkan status', async () => {
  const bot = { username: 'BotA', combatEngine: engine(true) }
  const cli = new Cli({ bot }, {}, silentLogger)
  const lines = await cli.handleCombat([])
  assert.equal(lines.length, 1)
  assert.match(lines[0], /BotA: aktif/)
  assert.match(lines[0], /smash 3/)
})

test('combat off mematikan engine', async () => {
  const e = engine(true)
  const cli = new Cli({ bot: { username: 'BotA', combatEngine: e } }, {}, silentLogger)
  const lines = await cli.handleCombat(['off'])
  assert.equal(e.enabled, false)
  assert.match(lines[0], /nonaktif/)
})

test('combat on menghidupkan kembali', async () => {
  const e = engine(false)
  const cli = new Cli({ bot: { username: 'BotA', combatEngine: e } }, {}, silentLogger)
  await cli.handleCombat(['on'])
  assert.equal(e.enabled, true)
})

test('combat berlaku untuk semua bot swarm', async () => {
  const a = engine(true)
  const b = engine(true)
  const swarm = {
    getConnectedBots: () => [
      { bot: { username: 'A', combatEngine: a } },
      { bot: { username: 'B', combatEngine: b } }
    ]
  }
  const cli = new Cli({ bot: null }, {}, silentLogger)
  cli.swarm = swarm
  const lines = await cli.handleCombat(['off'])
  assert.equal(lines.length, 2)
  assert.equal(a.enabled, false)
  assert.equal(b.enabled, false)
})

test('combat menolak argumen tak dikenal', async () => {
  const cli = new Cli({ bot: { username: 'BotA', combatEngine: engine() } }, {}, silentLogger)
  await assert.rejects(() => cli.handleCombat(['nyala']), /combat \[on\|off\]/)
})

test('combat gagal jelas bila belum terhubung', async () => {
  const cli = new Cli({ bot: null }, {}, silentLogger)
  await assert.rejects(() => cli.handleCombat([]), /belum terhubung/)
})
