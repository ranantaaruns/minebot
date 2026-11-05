'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { loadConfig, DEFAULTS } = require('../src/config')

function write (patch) {
  const base = JSON.parse(JSON.stringify(DEFAULTS))
  base.auth.password = 'rahasia'
  base.owner.username = 'Owner'
  Object.assign(base.server, { host: 'localhost', username: 'BotA', version: '1.21.11' })
  const merged = { ...base, ...patch }
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-cfg-')), 'config.json')
  fs.writeFileSync(file, JSON.stringify(merged), 'utf8')
  return file
}

test('DEFAULTS punya intel.tracker', () => {
  assert.equal(DEFAULTS.intel.tracker.enabled, true)
  assert.equal(DEFAULTS.intel.tracker.historyLength, 64)
  assert.equal(DEFAULTS.intel.tracker.alertChat, false)
})

test('loadConfig mengisi intel.tracker yang kosong', () => {
  const config = loadConfig(write({ intel: {} }))
  assert.equal(config.intel.tracker.alertRadius, 32)
})

test('nilai intel.tracker tidak valid ditolak', () => {
  assert.throws(() => loadConfig(write({ intel: { tracker: { historyLength: 0 } } })), /intel\.tracker\.historyLength/)
  assert.throws(() => loadConfig(write({ intel: { tracker: { saveDebounceMs: -1 } } })), /intel\.tracker\.saveDebounceMs/)
  assert.throws(() => loadConfig(write({ intel: { tracker: { dir: '' } } })), /intel\.tracker\.dir/)
})

test('angka intel.tracker dinormalisasi jadi Number', () => {
  const config = loadConfig(write({ intel: { tracker: { alertRadius: '48' } } }))
  assert.equal(config.intel.tracker.alertRadius, 48)
})
