'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { nextState, STATES, PRIORITY, createContext } = require('../src/combat/fsm')

const base = {
  onGround: true, elytraFlying: false, velocityY: 0,
  distance: 20, dy: 0, fallDistance: 0, heightAbove: 10,
  blocking: false, hasMace: true, hasElytra: true,
  ammo: 8, fireworks: 8, targetAlive: true,
  launchWindow: false, smashable: false, burst: false, clutch: false, shieldBroken: false
}

test('STATES mencakup semua fase', () => {
  assert.deepEqual(Object.keys(STATES), [
    'IDLE', 'LAUNCH', 'SMASH', 'BURST', 'FLY', 'CHARGE', 'CLUTCH', 'SHIELD'
  ])
})

test('PRIORITY sesuai spesifikasi', () => {
  assert.deepEqual(PRIORITY, ['CLUTCH', 'SHIELD', 'SMASH', 'BURST', 'FLY', 'LAUNCH', 'CHARGE'])
})

test('target mati atau tidak ada -> IDLE', () => {
  assert.equal(nextState(STATES.SMASH, { ...base, targetAlive: false }), STATES.IDLE)
  assert.equal(nextState(STATES.CHARGE, {}), STATES.IDLE)
})

test('clutch menang atas semua state lain', () => {
  assert.equal(nextState(STATES.SMASH, { ...base, clutch: true, smashable: true, blocking: true }), STATES.CLUTCH)
})

test('shield menang atas smash', () => {
  assert.equal(nextState(STATES.SMASH, { ...base, blocking: true, smashable: true }), STATES.SHIELD)
})

test('smash bila jendela smash terbuka', () => {
  assert.equal(nextState(STATES.LAUNCH, { ...base, smashable: true, onGround: false }), STATES.SMASH)
})

test('burst setelah smash bila ada dorongan wind burst', () => {
  assert.equal(nextState(STATES.SMASH, { ...base, burst: true, onGround: false }), STATES.BURST)
})

test('FLY bila sudah meluncur dan target jauh', () => {
  assert.equal(nextState(STATES.CHARGE, { ...base, elytraFlying: true, onGround: false, distance: 25 }), STATES.FLY)
})

test('LAUNCH hanya saat di tanah dengan jendela peluncuran', () => {
  assert.equal(nextState(STATES.IDLE, { ...base, launchWindow: true }), STATES.LAUNCH)
  assert.equal(nextState(STATES.IDLE, { ...base, launchWindow: true, onGround: false }), STATES.CHARGE)
})

test('CHARGE bila target dalam jangkauan dan tidak ada opsi mace', () => {
  assert.equal(nextState(STATES.IDLE, { ...base, distance: 4 }), STATES.CHARGE)
  assert.equal(nextState(STATES.IDLE, { ...base, distance: 30 }), STATES.IDLE)
})

test('tanpa mace dan tanpa elytra -> IDLE walau dekat', () => {
  assert.equal(nextState(STATES.IDLE, { ...base, distance: 4, hasMace: false, ammo: 0, hasElytra: false }), STATES.IDLE)
})

test('createContext membaca bot dan target', () => {
  const bot = {
    entity: { position: { x: 0, y: 64, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, onGround: true, elytraFlying: false },
    inventory: { items: () => [{ name: 'mace', count: 1 }, { name: 'wind_charge', count: 4 }, { name: 'elytra', count: 1 }] }
  }
  const target = { position: { x: 6, y: 64, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, health: 20 }
  const ctx = createContext({ bot, target, fallDistance: 0 })
  assert.equal(ctx.targetAlive, true)
  assert.equal(ctx.hasMace, true)
  assert.equal(ctx.ammo, 4)
  assert.equal(ctx.hasElytra, true)
  assert.ok(Math.abs(ctx.distance - 6) < 1e-6)
})

test('createContext menandai target mati', () => {
  const bot = { entity: { position: { x: 0, y: 64, z: 0 }, velocity: { x: 0, y: 0, z: 0 } }, inventory: { items: () => [] } }
  const ctx = createContext({ bot, target: { position: { x: 1, y: 64, z: 0 }, health: 0 } })
  assert.equal(ctx.targetAlive, false)
  assert.equal(nextState(STATES.FLY, ctx), STATES.IDLE)
})
