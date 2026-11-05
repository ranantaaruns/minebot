'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { loadConfig, DEFAULTS } = require('../src/config')

function writeConfig (data) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-config-pvp-'))
  const file = path.join(dir, 'config.json')
  fs.writeFileSync(file, JSON.stringify(data))
  return file
}

const base = () => ({
  server: { host: 'mc.example.com', port: '25565' },
  bot: { username: 'Bot' },
  owner: { username: 'Owner' },
  auth: { enabled: false }
})

test('DEFAULTS punya combat.pvp lengkap', () => {
  const pvp = DEFAULTS.combat.pvp
  assert.equal(pvp.enabled, true)
  assert.equal(pvp.tickMs, 50)
  assert.equal(pvp.smashRange, 3.2)
  assert.equal(pvp.minFall, 1.5)
  assert.equal(pvp.clutchMinFall, 3)
  assert.equal(pvp.clutchHeight, 1.8)
  assert.equal(pvp.chargeRange, 12)
  assert.equal(pvp.leadTicks, 1)
  assert.equal(pvp.maxChains, 3)
})

test('loadConfig mengisi pvp default saat config tidak menyebutnya', () => {
  const file = writeConfig(base())
  const config = loadConfig(file)
  assert.equal(config.combat.pvp.tickMs, 50)
  assert.equal(config.combat.pvp.chargeRange, 12)
})

test('loadConfig menormalkan angka pvp menjadi number', () => {
  const data = base()
  data.combat = { pvp: { tickMs: '40', smashRange: '3', minFall: '1.2', clutchMinFall: '3', clutchHeight: '2', chargeRange: '14', leadTicks: '2' } }
  const config = loadConfig(writeConfig(data))
  assert.equal(config.combat.pvp.tickMs, 40)
  assert.equal(config.combat.pvp.chargeRange, 14)
  assert.equal(typeof config.combat.pvp.leadTicks, 'number')
})

test('validasi menolak combat.pvp yang bukan object', () => {
  const data = base()
  data.combat = { pvp: 'ya' }
  assert.throws(() => loadConfig(writeConfig(data)), /combat\.pvp/)
})

test('validasi menolak nilai nol pada combat.pvp', () => {
  const data = base()
  data.combat = { pvp: { tickMs: 0 } }
  assert.throws(() => loadConfig(writeConfig(data)), /combat\.pvp\.tickMs/)
})

test('pvp.enabled=false dipertahankan', () => {
  const data = base()
  data.combat = { pvp: { enabled: false } }
  const config = loadConfig(writeConfig(data))
  assert.equal(config.combat.pvp.enabled, false)
})
