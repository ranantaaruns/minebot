'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const Vec3 = require('vec3')
const mcData = require('minecraft-data')('1.21.4')
const { mineAncientDebris } = require('../src/materials/ancient-debris')

const silentLogger = {
  info () {},
  warn () {},
  debug () {},
  error () {}
}

const pickaxe = { type: mcData.itemsByName.diamond_pickaxe.id, name: 'diamond_pickaxe', count: 1 }

function debrisBot ({ position = new Vec3(0, 14, 0), lava = [], debris = [], items = [pickaxe] } = {}) {
  const lavaSet = new Set(lava.map(p => `${p.x},${p.y},${p.z}`))
  const bot = {
    version: '1.21.4',
    registry: mcData,
    game: { dimension: 'minecraft:the_nether' },
    entity: { position, onFire: false, height: 1.8 },
    health: 20,
    food: 20,
    inventory: {
      items: () => items.slice(),
      slots: [],
      emptySlotCount: () => 10
    },
    digCalls: [],
    equipped: [],
    findBlocks: () => debris.slice(),
    blockAt (p) {
      if (lavaSet.has(`${p.x},${p.y},${p.z}`)) return { name: 'lava', boundingBox: 'empty' }
      if (p.y < 14) return { name: 'netherrack', boundingBox: 'block' }
      return { name: 'air', boundingBox: 'empty' }
    },
    async equip (item) { this.equipped.push(item.name) },
    async dig (block) { this.digCalls.push(block.name || 'block') },
    pathfinder: {
      stopCalls: 0,
      stop () { this.stopCalls++ },
      setMovements (movements) { this.movements = movements },
      async goto () {}
    },
    clearControlStates () {},
    setControlState () {}
  }
  return bot
}

test('mineAncientDebris tidak menggali lorong yang berbatasan lava dan berhenti aman', async () => {
  const logs = []
  const logger = { ...silentLogger, warn: msg => logs.push(msg) }
  // Lava dua blok di depan lorong (masih dalam radius aman 2 blok)
  const bot = debrisBot({ lava: [new Vec3(2, 14, 0), new Vec3(2, 15, 0)] })

  const result = await mineAncientDebris(bot, mcData, null, 4, {
    logger,
    maxRounds: 8
  })

  assert.equal(result.ok, false)
  assert.equal(result.reason, 'lava-blocked')
  assert.equal(bot.digCalls.length, 0, 'tidak boleh menggali ke arah lava')
  assert.ok(logs.some(msg => /lava/i.test(msg)))
})

test('mineAncientDebris melewati ancient debris yang bersebelahan diagonal dengan lava', async () => {
  const debrisPos = new Vec3(2, 14, 2)
  const bot = debrisBot({
    lava: [new Vec3(3, 15, 3)],
    debris: [debrisPos]
  })
  bot.blockAt = (function (original) {
    return p => {
      if (p.equals(debrisPos)) return { name: 'ancient_debris', boundingBox: 'block', type: mcData.blocksByName.ancient_debris.id }
      return original(p)
    }
  })(bot.blockAt)
  let collected = 0
  bot.collectBlock = {
    movements: null,
    async collect () { collected++ }
  }

  const result = await mineAncientDebris(bot, mcData, null, 2, { logger: silentLogger, maxRounds: 2 })

  assert.equal(collected, 0, 'debris di samping lava harus dilewati')
  assert.equal(result.ok, false)
  assert.equal(result.have, 0)
})
