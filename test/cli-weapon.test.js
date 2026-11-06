'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { Cli } = require('../src/cli')

const silentLogger = { info () {}, warn () {}, error () {}, debug () {}, chat () {} }

function engine (missing = {}) {
  return {
    weaponMode: 'normal',
    enabled: true,
    stats: {},
    setWeaponMode (mode) { this.weaponMode = mode },
    equipmentStatus (mode) {
      const absent = missing[mode] || []
      return { ok: absent.length === 0, missing: absent }
    }
  }
}

test('weapon tanpa argumen menampilkan mode aktif dan status perlengkapan', async () => {
  const e = engine()
  const cli = new Cli({ bot: { username: 'BotA', combatEngine: e } }, {}, silentLogger)
  const lines = await cli.handleWeapon([])
  assert.match(lines[0], /BotA: normal/)
  assert.match(lines[0], /siap/)
})

test('weapon mace dan spear mengubah mode setelah validasi', async () => {
  const e = engine()
  const cli = new Cli({ bot: { username: 'BotA', combatEngine: e } }, {}, silentLogger)
  await cli.handleWeapon(['mace'])
  assert.equal(e.weaponMode, 'mace')
  await cli.handleWeapon(['spear'])
  assert.equal(e.weaponMode, 'spear')
  await cli.handleWeapon(['normal'])
  assert.equal(e.weaponMode, 'normal')
})

test('weapon mace menolak bila wind charge tidak ada dan tidak mengubah mode', async () => {
  const e = engine({ mace: ['wind_charge'] })
  const cli = new Cli({ bot: { username: 'BotA', combatEngine: e } }, {}, silentLogger)
  await assert.rejects(() => cli.handleWeapon(['mace']), /wind_charge/)
  assert.equal(e.weaponMode, 'normal')
})

test('weapon spear menolak bila elytra atau firework tidak ada', async () => {
  const e = engine({ spear: ['elytra', 'firework_rocket'] })
  const cli = new Cli({ bot: { username: 'BotA', combatEngine: e } }, {}, silentLogger)
  await assert.rejects(() => cli.handleWeapon(['spear']), /elytra, firework_rocket/)
  assert.equal(e.weaponMode, 'normal')
})

test('weapon berlaku atomik untuk swarm: satu bot kurang perlengkapan membatalkan semua', async () => {
  const a = engine()
  const b = engine({ mace: ['mace'] })
  const cli = new Cli({ bot: null }, {}, silentLogger)
  cli.swarm = {
    getConnectedBots: () => [
      { bot: { username: 'A', combatEngine: a } },
      { bot: { username: 'B', combatEngine: b } }
    ]
  }
  await assert.rejects(() => cli.handleWeapon(['mace']), /B: mace/)
  assert.equal(a.weaponMode, 'normal')
  assert.equal(b.weaponMode, 'normal')
})

test('handleLine mengenali perintah weapon dan menolak mode tak dikenal', async () => {
  const e = engine()
  const cli = new Cli({ bot: { username: 'BotA', combatEngine: e } }, {}, silentLogger)
  await cli.handleLine('weapon mace')
  assert.equal(e.weaponMode, 'mace')
  await assert.rejects(() => cli.handleWeapon(['bow']), /weapon \[normal\|mace\|spear\]/)
})
