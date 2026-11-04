'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { loadConfig } = require('../src/config')

function writeConfig (data) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-config-'))
  const file = path.join(dir, 'config.json')
  fs.writeFileSync(file, JSON.stringify(data))
  return { dir, file }
}

test('loadConfig merges defaults and coerces the port', () => {
  const { dir, file } = writeConfig({
    server: { host: 'mc.example.com', port: '25565' },
    bot: { username: 'Bot' },
    owner: { username: 'Owner' },
    auth: { enabled: false }
  })

  const config = loadConfig(file)
  assert.equal(config.server.port, 25565)
  assert.equal(config.build.maxVolume, 200000)
  assert.equal(config.owner.autoFollow, true)
  assert.equal(config.owner.stuckTimeoutMs, 4000)
  assert.equal(config.physics.paperCollisionFix, true)
  assert.equal(config.physics.playerHalfWidth, 0.30001)
  assert.equal(config.owner.allowTower, true)
  assert.equal(config.owner.towerBlocks[0], 'dirt')
  assert.equal(config.owner.towerGather.reserve, 8)
  assert.equal(config.owner.towerGather.allowHandMining, true)
  assert.equal(config.owner.swim.enabled, true)
  assert.equal(config.owner.swim.liquidCost, 12)
  assert.equal(config.safety.criticalFood, 6)
  assert.equal(config.safety.noFoodAction, 'stop')
  assert.equal(config.safety.preventDrowning, true)
  assert.equal(config.__file, file)

  fs.rmSync(dir, { recursive: true, force: true })
})

test('loadConfig rejects placeholders and missing required fields', () => {
  const { dir, file } = writeConfig({
    server: { host: 'mc.example.com' },
    bot: { username: 'Bot' },
    owner: { username: 'NamaKamu' },
    auth: { enabled: true, password: 'GANTI_PASSWORD_INI' }
  })

  assert.throws(() => loadConfig(file), err => {
    assert.equal(err.code, 'CONFIG_INVALID')
    assert.match(err.message, /owner\.username/)
    assert.match(err.message, /auth\.password/)
    return true
  })

  fs.rmSync(dir, { recursive: true, force: true })
})

test('loadConfig validates tower settings', () => {
  const { dir, file } = writeConfig({
    server: { host: 'mc.example.com' },
    bot: { username: 'Bot' },
    owner: {
      username: 'Owner',
      towerBlocks: [],
      towerPlaceCost: -1,
      towerGather: {
        preferredBlocks: 'grass_block',
        radius: -1,
        maxAttempts: 'x'
      }
    },
    auth: { enabled: false }
  })

  assert.throws(() => loadConfig(file), err => {
    assert.equal(err.code, 'CONFIG_INVALID')
    assert.match(err.message, /owner\.towerBlocks/)
    assert.match(err.message, /owner\.towerPlaceCost/)
    assert.match(err.message, /owner\.towerGather\.preferredBlocks/)
    assert.match(err.message, /owner\.towerGather\.radius/)
    assert.match(err.message, /owner\.towerGather\.maxAttempts/)
    return true
  })

  fs.rmSync(dir, { recursive: true, force: true })
})

test('loadConfig reports a missing config file', () => {
  assert.throws(
    () => loadConfig(path.join(os.tmpdir(), 'mcbot-does-not-exist.json')),
    err => err.code === 'CONFIG_MISSING'
  )
})

test('loadConfig rejects invalid physics and stuck recovery values', () => {
  const { dir, file } = writeConfig({
    server: { host: 'mc.example.com' },
    bot: { username: 'Bot' },
    owner: { username: 'Owner', stuckTimeoutMs: 0, maxStuckRetries: -1 },
    physics: { playerHalfWidth: 0, playerHeight: 'x' },
    auth: { enabled: false }
  })

  assert.throws(() => loadConfig(file), err => {
    assert.equal(err.code, 'CONFIG_INVALID')
    assert.match(err.message, /physics\.playerHalfWidth/)
    assert.match(err.message, /physics\.playerHeight/)
    assert.match(err.message, /owner\.stuckTimeoutMs/)
    assert.match(err.message, /owner\.maxStuckRetries/)
    return true
  })

  fs.rmSync(dir, { recursive: true, force: true })
})

test('loadConfig validates food and swim settings', () => {
  const { dir, file } = writeConfig({
    server: { host: 'mc.example.com' },
    bot: { username: 'Bot' },
    owner: {
      username: 'Owner',
      swim: {
        liquidCost: -1,
        updateMs: 0,
        timeoutMs: 'x',
        strafeMs: 0,
        approachTimeoutMs: 0
      }
    },
    safety: {
      eatThreshold: 30,
      criticalFood: 40,
      eatCheckIntervalMs: 0,
      eatRetryMs: 'x',
      noFoodAction: 'explode'
    },
    auth: { enabled: false }
  })

  assert.throws(() => loadConfig(file), err => {
    assert.equal(err.code, 'CONFIG_INVALID')
    assert.match(err.message, /owner\.swim\.liquidCost/)
    assert.match(err.message, /owner\.swim\.updateMs/)
    assert.match(err.message, /owner\.swim\.timeoutMs/)
    assert.match(err.message, /safety\.eatThreshold/)
    assert.match(err.message, /safety\.criticalFood/)
    assert.match(err.message, /safety\.noFoodAction/)
    return true
  })

  fs.rmSync(dir, { recursive: true, force: true })
})
