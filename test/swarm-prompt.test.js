'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { promptSwarmConfig } = require('../src/swarm/prompt')

function baseConfig (overrides = {}) {
  return {
    server: { host: '127.0.0.1', port: 25565 },
    bot: { username: 'Bot' },
    owner: { username: 'Owner' },
    swarm: { maxBots: 50 },
    ...overrides
  }
}

test('non-interactive menghormati bot.count sampai 50', async () => {
  const bots = await promptSwarmConfig(baseConfig({ bot: { username: 'Bot', count: 50 } }))
  assert.equal(bots.length, 50)
  assert.equal(bots[0].username, 'Bot')
  assert.equal(bots[49].username, 'Bot_50')
})

test('non-interactive memotong bot.count di atas 50 ke maxBots', async () => {
  const bots = await promptSwarmConfig(baseConfig({ bot: { username: 'Bot', count: 80 } }))
  assert.equal(bots.length, 50)
})

test('non-interactive memotong daftar bots ke maxBots', async () => {
  const bots = await promptSwarmConfig(baseConfig({
    bots: Array.from({ length: 60 }, (_, i) => ({ username: `B${i + 1}` }))
  }))
  assert.equal(bots.length, 50)
  assert.equal(bots[49].username, 'B50')
})

test('maxBots dari config dipakai sebagai batas atas', async () => {
  const bots = await promptSwarmConfig(baseConfig({ swarm: { maxBots: 8 }, bot: { username: 'Bot', count: 20 } }))
  assert.equal(bots.length, 8)
})

test('maxBots tidak boleh melewati 50 meski config lebih besar', async () => {
  const bots = await promptSwarmConfig(baseConfig({ swarm: { maxBots: 500 }, bot: { username: 'Bot', count: 500 } }))
  assert.equal(bots.length, 50)
})
