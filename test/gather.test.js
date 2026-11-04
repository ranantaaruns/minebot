'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const Vec3 = require('vec3')
const mcData = require('minecraft-data')('1.21.4')
const { mineItem } = require('../src/materials/gather')

const silentLogger = {
  info () {},
  warn () {},
  debug () {},
  error () {}
}

const coalBlock = mcData.blocksByName.coal_ore.id

function fakeBot (positions, { failWith = null } = {}) {
  const blocks = positions.map(position => ({ position, type: coalBlock, name: 'coal_ore' }))
  return {
    version: '1.21.4',
    registry: mcData,
    entity: { position: new Vec3(0, 64, 0) },
    health: 20,
    inventory: {
      items: () => [],
      emptySlotCount: () => 10
    },
    findBlocks: () => positions.slice(),
    blockAt: pos => blocks.find(block => block.position.equals(pos)) || null,
    collectBlock: {
      movements: null,
      calls: 0,
      async collect () {
        this.calls++
        if (failWith) throw failWith
      }
    },
    pathfinder: {
      stops: 0,
      movements: null,
      stop () { this.stops++ },
      setMovements (movements) { this.movements = movements }
    },
    clearControlStates () {}
  }
}

function fakeMaterials () {
  return {
    minedCount: 0,
    async ensureTool () { return true },
    async _ensureInventorySpace () {}
  }
}

function noPathError () {
  const err = new Error('No path to the goal!')
  err.name = 'NoPath'
  return err
}

test('mining hands follow-grade movements to collectBlock so towering is possible', async () => {
  const positions = [new Vec3(1, 64, 0)]
  const bot = fakeBot(positions)
  let usedMovements = null
  bot.collectBlock.collect = async function () {
    usedMovements = this.movements
    this.calls++
  }

  await mineItem(bot, mcData, fakeMaterials(), 'coal', 4, {
    logger: silentLogger,
    allowHandMining: true,
    movementOptions: {
      allowTower: true,
      towerBlocks: ['dirt', 'cobblestone']
    }
  })

  assert.ok(usedMovements, 'collectBlock harus memakai movements hasil applyMovements')
  assert.equal(usedMovements.allow1by1towers, true)
  const scaffoldNames = usedMovements.scafoldingBlocks.map(id => mcData.items[id].name)
  assert.ok(scaffoldNames.includes('dirt'))
  assert.equal(bot.pathfinder.movements, usedMovements)
})

test('mining stops quickly and resets the pathfinder when blocks are unreachable', async () => {
  const positions = [
    new Vec3(1, 70, 0),
    new Vec3(2, 70, 0),
    new Vec3(3, 70, 0),
    new Vec3(4, 70, 0)
  ]
  const bot = fakeBot(positions, { failWith: noPathError() })

  const result = await mineItem(bot, mcData, fakeMaterials(), 'coal', 4, {
    logger: silentLogger,
    allowHandMining: true
  })

  assert.equal(result.reason, 'unreachable')
  assert.equal(result.mined, 0)
  assert.equal(bot.collectBlock.calls, 2, 'berhenti setelah dua kegagalan jalur, bukan delapan')
  assert.ok(bot.pathfinder.stops >= 2, 'pathfinder dihentikan agar tidak macet')
})
