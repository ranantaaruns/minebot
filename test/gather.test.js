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

function caveMiningBot ({ orePositions = [], dimension = 'minecraft:overworld' } = {}) {
  const oreBlocks = orePositions.map(position => ({ position, type: coalBlock, name: 'coal_ore' }))
  const air = []
  for (let x = 8; x <= 14; x++) {
    for (let dy = 0; dy < 3; dy++) air.push(new Vec3(x, 30 + dy, 0))
  }
  const bot = {
    version: '1.21.4',
    registry: mcData,
    game: { dimension },
    entity: { position: new Vec3(0, 32, 0) },
    health: 20,
    inventory: { items: () => [], emptySlotCount: () => 10 },
    findBlocks ({ matching, maxDistance, count }) {
      const list = matching ? air : orePositions
      return list
        .filter(p => p.distanceTo(this.entity.position) <= maxDistance)
        .slice(0, count)
    },
    blockAt (pos) {
      const ore = oreBlocks.find(block => block.position.equals(pos))
      if (ore) return ore
      if (air.some(p => p.equals(pos))) return { name: 'cave_air', boundingBox: 'empty' }
      return { name: 'stone', boundingBox: 'block' }
    },
    collectBlock: {
      movements: null,
      calls: 0,
      async collect () { this.calls++ }
    },
    pathfinder: {
      gotoCalls: 0,
      async goto (goal) {
        this.gotoCalls++
        this.goal = goal
        // setelah "berjalan", bot berada di cave
        bot.entity.position = new Vec3(11, 30, 0)
      },
      stop () {},
      setMovements (movements) { this.movements = movements }
    },
    clearControlStates () {}
  }
  return bot
}

test('mining di overworld berjalan ke cave terdekat lebih dulu', async () => {
  const bot = caveMiningBot({ orePositions: [new Vec3(40, 30, 0), new Vec3(12, 31, 0)] })

  await mineItem(bot, mcData, fakeMaterials(), 'coal', 2, {
    logger: silentLogger,
    allowHandMining: true,
    preferCaves: true,
    caveMinOreDistance: 6
  })

  assert.equal(bot.pathfinder.gotoCalls, 1, 'bot harus menuju cave lebih dulu')
  assert.ok(bot.collectBlock.calls >= 1)
  assert.ok(bot.entity.position.x >= 8, 'bot sudah berada di area cave saat menambang')
})

test('mining tidak mencari cave bila ore sudah dekat', async () => {
  const bot = caveMiningBot({ orePositions: [new Vec3(2, 32, 0)] })

  await mineItem(bot, mcData, fakeMaterials(), 'coal', 2, {
    logger: silentLogger,
    allowHandMining: true,
    preferCaves: true
  })

  assert.equal(bot.pathfinder.gotoCalls, 0)
})

test('mining di Nether tidak mencari cave overworld', async () => {
  const bot = caveMiningBot({
    orePositions: [new Vec3(40, 30, 0)],
    dimension: 'minecraft:the_nether'
  })

  await mineItem(bot, mcData, fakeMaterials(), 'coal', 2, {
    logger: silentLogger,
    allowHandMining: true,
    preferCaves: true
  })

  assert.equal(bot.pathfinder.gotoCalls, 0)
})
