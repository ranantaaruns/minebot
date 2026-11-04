'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { ShieldBreakStrategy, enemyHoldsShield, enemyRaisingShield } = require('../src/safety/shieldbreak')

const SHIELD = { name: 'shield', type: 442 }
const SWORD = { name: 'diamond_sword', type: 276 }

function enemy (overrides = {}) {
  return { id: 7, name: 'player', health: 20, heldItem: SHIELD, ...overrides }
}

test('deteksi lawan memegang shield dari tangan utama maupun off-hand', () => {
  assert.equal(enemyHoldsShield({ heldItem: SHIELD }), true)
  assert.equal(enemyHoldsShield({ equipment: [SHIELD] }), true)
  assert.equal(enemyHoldsShield({ equipment: { 0: SWORD, 1: SHIELD } }), true)
  assert.equal(enemyHoldsShield({ heldItem: SWORD }), false)
  assert.equal(enemyHoldsShield(null), false)
})

test('deteksi tangan aktif (metadata) hanya dipercaya kalau lawan memegang shield', () => {
  const metadata = []
  metadata[7] = 1
  assert.equal(enemyRaisingShield({ heldItem: SHIELD, metadata }), true)
  assert.equal(enemyRaisingShield({ heldItem: SWORD, metadata }), false, 'tanpa shield tidak dianggap blok')
  assert.equal(enemyRaisingShield({ heldItem: SHIELD }), false, 'tanpa metadata tidak ditebak')
})

test('default memakai pedang, kapak hanya saat lawan memblok', () => {
  const strategy = new ShieldBreakStrategy()
  assert.equal(strategy.weapon({ heldItem: SWORD }), 'sword')
  const raised = enemy({ metadata: [null, null, null, null, null, null, null, 1] })
  assert.equal(strategy.weapon(raised), 'axe')
})

test('pukulan yang tidak mengurangi darah lawan bikin bot beralih ke kapak', () => {
  const strategy = new ShieldBreakStrategy()
  const target = enemy()

  strategy.beforeAttack(target)
  assert.equal(strategy.afterAttack(target, 'sword'), 'blocked', 'darah tidak turun = diblok')
  assert.equal(strategy.weapon(target), 'axe')
})

test('pukulan yang mengurangi darah lawan tidak memicu kapak', () => {
  const strategy = new ShieldBreakStrategy()
  const target = enemy({ health: 20 })

  strategy.beforeAttack(target)
  target.health = 14
  assert.equal(strategy.afterAttack(target, 'sword'), 'hit')
  assert.equal(strategy.weapon(target), 'sword')
})

test('pukulan kapak memulai masa cooldown shield lalu bot kembali ke pedang', () => {
  const strategy = new ShieldBreakStrategy({ punishMs: 5000 })
  const target = enemy()
  const now = Date.now()

  strategy.beforeAttack(target, now)
  assert.equal(strategy.afterAttack(target, 'axe', now + 100), 'broke', 'shield masih menahan tapi cooldown')
  assert.equal(strategy.stats.breaks, 1)
  assert.equal(strategy.weapon(target, now + 200), 'sword', 'serang pakai pedang selama shield cooldown')
  assert.equal(strategy.weapon(target, now + 4000), 'sword')
  assert.equal(strategy.weapon(target, now + 6000), 'sword', 'tanpa bukti baru, tetap pedang')

  // Setelah cooldown habis lawan mengangkat shield lagi: entah metadata
  // menangkapnya, atau satu pukulan pedang tertahan dulu.
  const raisedAgain = enemy({ metadata: [null, null, null, null, null, null, null, 1] })
  assert.equal(strategy.weapon(raisedAgain, now + 6000), 'axe')

  strategy.beforeAttack(target, now + 6100)
  assert.equal(strategy.afterAttack(target, 'sword', now + 6200), 'blocked')
  assert.equal(strategy.weapon(target, now + 6200), 'axe', 'pukulan tertahan memicu kapak lagi')
})

test('tanpa data darah, strategi tidak menebak dan tetap pakai pedang', () => {
  const strategy = new ShieldBreakStrategy()
  const target = { id: 9, heldItem: SHIELD }

  strategy.beforeAttack(target)
  assert.equal(strategy.afterAttack(target, 'sword'), 'unknown')
  assert.equal(strategy.weapon(target), 'sword')
})

test('pukulan kedaluwarsa diabaikan supaya tidak salah menyimpulkan blok', () => {
  const strategy = new ShieldBreakStrategy({ windowMs: 50 })
  const target = enemy()
  const now = Date.now()

  strategy.beforeAttack(target, now)
  assert.equal(strategy.afterAttack(target, 'sword', now + 500), 'unknown')
  assert.equal(strategy.weapon(target), 'sword')
})

test('reset membersihkan state antar job', () => {
  const strategy = new ShieldBreakStrategy()
  const target = enemy()
  strategy.beforeAttack(target)
  strategy.afterAttack(target, 'axe')
  assert.equal(strategy.stats.breaks, 1)

  strategy.reset()
  assert.equal(strategy.stats.breaks, 0)
  assert.equal(strategy.inPunishWindow(), false)
  assert.equal(strategy.weapon(target), 'sword', 'job baru mulai dengan pedang')

  strategy.beforeAttack(target)
  assert.equal(strategy.afterAttack(target, 'sword'), 'blocked')
  assert.equal(strategy.weapon(target), 'axe')
})

test('strategi bisa dimatikan lewat config', () => {
  const strategy = new ShieldBreakStrategy({ enabled: false })
  const raised = enemy({ metadata: [null, null, null, null, null, null, null, 1] })
  assert.equal(strategy.weapon(raised), 'sword')
})
