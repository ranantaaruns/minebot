'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { loadConfig } = require('../src/config')

function writeConfig (data) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-config-features-'))
  const file = path.join(dir, 'config.json')
  fs.writeFileSync(file, JSON.stringify(data))
  return { dir, file }
}

function baseConfig (overrides = {}) {
  return {
    server: { host: 'mc.example.com', port: '25565' },
    bot: { username: 'Bot' },
    owner: { username: 'Owner' },
    auth: { enabled: false },
    ...overrides
  }
}

test('loadConfig exposes navigation, combat, storage and biome defaults', () => {
  const { dir, file } = writeConfig(baseConfig())

  const config = loadConfig(file)
  assert.equal(config.owner.navigation.surfaceBias, true)
  assert.equal(config.owner.navigation.maxDescent, 2)
  assert.equal(config.combat.enabled, true)
  assert.equal(config.combat.autoArmor, true)
  assert.deepEqual(config.storage.containers, ['chest', 'trapped_chest', 'barrel', 'shulker_box'])
  assert.equal(config.gamemode.enabled, true)
  assert.equal(config.gamemode.buildMode, 'creative')
  assert.equal(config.gamemode.restoreAfterBuild, true)
  assert.equal(config.gamemode.switchTimeoutMs, 3000)
  assert.equal(config.build.biomeMaterials.enabled, true)
  assert.equal(config.build.biomeMaterials.ownerSupplyTimeoutMs, 0)
  assert.equal(config.gather.clearChestObstructions, true)
  assert.equal(config.gather.clearHeight, 3)

  fs.rmSync(dir, { recursive: true, force: true })
})

test('loadConfig coerces the new numeric options', () => {
  const { dir, file } = writeConfig(baseConfig({
    owner: {
      username: 'Owner',
      navigation: { surfaceBias: false, verticalThreshold: '5', maxDescent: '3', coverScanHeight: '6' }
    },
    combat: { attackRange: '4.5', detectRadius: '10', maxPursueDistance: '7', attackCooldownMs: '500', defendTimeoutMs: '9000' },
    storage: { radius: '48', minFreeSlots: '3' },
    gamemode: { switchTimeoutMs: '4500' },
    build: { biomeMaterials: { reminderMs: '15000', pickupRadius: '6', ownerSupplyTimeoutMs: '60000' } },
    gather: { chestRadius: '40', clearHeight: '4' }
  }))

  const config = loadConfig(file)
  assert.equal(config.owner.navigation.verticalThreshold, 5)
  assert.equal(config.owner.navigation.maxDescent, 3)
  assert.equal(config.combat.attackRange, 4.5)
  assert.equal(config.storage.radius, 48)
  assert.equal(config.gamemode.switchTimeoutMs, 4500)
  assert.equal(config.build.biomeMaterials.ownerSupplyTimeoutMs, 60000)
  assert.equal(config.gather.chestRadius, 40)
  assert.equal(config.gather.clearHeight, 4)

  fs.rmSync(dir, { recursive: true, force: true })
})

test('loadConfig rejects invalid feature settings', () => {
  const { dir, file } = writeConfig(baseConfig({
    owner: {
      username: 'Owner',
      navigation: { verticalThreshold: -1, maxDescent: 'x', coverScanHeight: -2 }
    },
    combat: { attackRange: 0, detectRadius: -1, attackCooldownMs: 'x' },
    storage: { radius: 0, minFreeSlots: -1, containers: [] },
    build: { biomeMaterials: { reminderMs: -1, pickupRadius: 'x', ownerSupplyTimeoutMs: -5 } },
    gather: { chestRadius: 0, clearHeight: -1 }
  }))

  assert.throws(() => loadConfig(file), err => {
    assert.equal(err.code, 'CONFIG_INVALID')
    assert.match(err.message, /owner\.navigation\.verticalThreshold/)
    assert.match(err.message, /combat\.attackRange/)
    assert.match(err.message, /storage\.radius/)
    assert.match(err.message, /storage\.containers/)
    assert.match(err.message, /build\.biomeMaterials\.reminderMs/)
    assert.match(err.message, /gather\.clearHeight/)
    return true
  })

  fs.rmSync(dir, { recursive: true, force: true })
})

test('loadConfig menyediakan dan memvalidasi opsi combat.hunt', () => {
  const defaults = writeConfig(baseConfig())
  const config = loadConfig(defaults.file)
  assert.equal(config.combat.hunt.meleeRange, 3.2)
  assert.equal(config.combat.hunt.bowRange, 24)
  assert.equal(config.combat.hunt.drawMs, 1000)
  assert.equal(config.combat.hunt.timeoutMs, 180000)
  assert.equal(config.combat.hunt.lavaEnabled, true)
  assert.equal(config.combat.hunt.lavaCooldownMs, 12000)
  assert.equal(config.combat.hunt.lavaBurnTicks, 8)
  assert.equal(config.combat.hunt.lavaRange, 3.2)
  assert.equal(config.combat.hunt.lavaPickupAttempts, 3)
  fs.rmSync(defaults.dir, { recursive: true, force: true })

  const custom = writeConfig(baseConfig({
    combat: { hunt: { bowRange: '32', drawMs: '800', tickMs: '100', meleeRange: '4', timeoutMs: '60000', lavaCooldownMs: '8000', lavaBurnTicks: '5', lavaRange: '4.5', lavaPickupAttempts: '4' } }
  }))
  const parsed = loadConfig(custom.file)
  assert.equal(parsed.combat.hunt.bowRange, 32)
  assert.equal(parsed.combat.hunt.drawMs, 800)
  assert.equal(parsed.combat.hunt.tickMs, 100)
  assert.equal(parsed.combat.hunt.meleeRange, 4)
  assert.equal(parsed.combat.hunt.timeoutMs, 60000)
  assert.equal(parsed.combat.hunt.lavaCooldownMs, 8000)
  assert.equal(parsed.combat.hunt.lavaBurnTicks, 5)
  assert.equal(parsed.combat.hunt.lavaRange, 4.5)
  assert.equal(parsed.combat.hunt.lavaPickupAttempts, 4)
  fs.rmSync(custom.dir, { recursive: true, force: true })

  const invalid = writeConfig(baseConfig({ combat: { hunt: { bowRange: 0, drawMs: 'x', lavaCooldownMs: -1, lavaBurnTicks: 0, lavaRange: -1, lavaPickupAttempts: -2 } } }))
  assert.throws(() => loadConfig(invalid.file), err => {
    assert.equal(err.code, 'CONFIG_INVALID')
    assert.match(err.message, /combat\.hunt\.bowRange/)
    assert.match(err.message, /combat\.hunt\.drawMs/)
    assert.match(err.message, /combat\.hunt\.lavaCooldownMs/)
    assert.match(err.message, /combat\.hunt\.lavaBurnTicks/)
    assert.match(err.message, /combat\.hunt\.lavaRange/)
    assert.match(err.message, /combat\.hunt\.lavaPickupAttempts/)
    return true
  })
  fs.rmSync(invalid.dir, { recursive: true, force: true })
})

test('loadConfig mendukung swarm sampai 50 bot', () => {
  const defaults = writeConfig(baseConfig())
  const config = loadConfig(defaults.file)
  assert.equal(config.swarm.maxBots, 50)
  fs.rmSync(defaults.dir, { recursive: true, force: true })

  const many = writeConfig(baseConfig({
    swarm: { maxBots: 50 },
    bots: Array.from({ length: 50 }, (_, i) => ({ username: `Bot${i + 1}` }))
  }))
  const parsed = loadConfig(many.file)
  assert.equal(parsed.swarm.maxBots, 50)
  fs.rmSync(many.dir, { recursive: true, force: true })

  const tooMany = writeConfig(baseConfig({
    swarm: { maxBots: 50 },
    bots: Array.from({ length: 51 }, (_, i) => ({ username: `Bot${i + 1}` }))
  }))
  assert.throws(() => loadConfig(tooMany.file), err => {
    assert.equal(err.code, 'CONFIG_INVALID')
    assert.match(err.message, /swarm\.maxBots/)
    return true
  })
  fs.rmSync(tooMany.dir, { recursive: true, force: true })

  const badMax = writeConfig(baseConfig({ swarm: { maxBots: 51 } }))
  assert.throws(() => loadConfig(badMax.file), err => {
    assert.equal(err.code, 'CONFIG_INVALID')
    assert.match(err.message, /swarm\.maxBots/)
    return true
  })
  fs.rmSync(badMax.dir, { recursive: true, force: true })
})
