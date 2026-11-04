'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const Vec3 = require('vec3')
const {
  CombatManager,
  isHostile,
  weaponScore,
  armorInfo,
  bestArmor,
  bestWeapon
} = require('../src/safety/combat')

const silentLogger = {
  info () {},
  warn () {},
  debug () {},
  error () {}
}

function combatConfig (overrides = {}) {
  return {
    enabled: true,
    autoArmor: true,
    attackRange: 3.5,
    detectRadius: 8,
    attackCooldownMs: 650,
    defendTimeoutMs: 12000,
    ...overrides
  }
}

test('isHostile only accepts hostile mob names', () => {
  assert.equal(isHostile('minecraft:zombie'), true)
  assert.equal(isHostile('skeleton'), true)
  assert.equal(isHostile('cow'), false)
  assert.equal(isHostile('player'), false)
})

test('weapon and armor scoring prefer stronger gear', () => {
  assert.ok(weaponScore('diamond_sword') > weaponScore('stone_sword'))
  assert.ok(weaponScore('mace') > weaponScore('diamond_sword'))
  assert.ok(weaponScore('netherite_sword') > weaponScore('mace'))
  assert.ok(weaponScore('stone_sword') > weaponScore('diamond_axe'))
  assert.equal(weaponScore('apple'), 0)

  assert.deepEqual(armorInfo('diamond_helmet'), { destination: 'head', slot: 5, score: 55 })
  assert.equal(armorInfo('apple'), null)
})

test('bestArmor and bestWeapon pick the strongest inventory items', () => {
  const items = [
    { name: 'leather_helmet', count: 1 },
    { name: 'diamond_helmet', count: 1 },
    { name: 'iron_chestplate', count: 1 },
    { name: 'wooden_sword', count: 1 },
    { name: 'iron_sword', count: 1 }
  ]

  const armor = bestArmor(items)
  assert.equal(armor.get('head').item.name, 'diamond_helmet')
  assert.equal(armor.get('torso').item.name, 'iron_chestplate')
  assert.equal(bestWeapon(items).item.name, 'iron_sword')
})

test('findTarget ignores players and mobs outside the detection radius', () => {
  const bot = {
    entity: { position: new Vec3(0, 64, 0) },
    entities: {
      1: { name: 'zombie', position: new Vec3(2, 64, 0) },
      2: { name: 'skeleton', position: new Vec3(20, 64, 0) },
      3: { name: 'Owner', username: 'Owner', position: new Vec3(1, 64, 0) }
    }
  }
  const combat = new CombatManager(bot, combatConfig(), silentLogger)
  const target = combat.findTarget()

  assert.equal(target.entity.name, 'zombie')
  assert.equal(target.distance, 2)
})

test('findTarget returns null when only players are nearby', () => {
  const bot = {
    entity: { position: new Vec3(0, 64, 0) },
    entities: {
      1: { name: 'Owner', username: 'Owner', position: new Vec3(1, 64, 0) }
    }
  }
  const combat = new CombatManager(bot, combatConfig(), silentLogger)
  assert.equal(combat.findTarget(), null)
})
