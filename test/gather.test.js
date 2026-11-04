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
  const bot = {
    version: '1.21.4',
    registry: mcData,
    entity: { position: new Vec3(0, 64, 0) },
    health: 20,
    inventory: {
      items: () => [],
      emptySlotCount: () => 10
    },
    findBlocks: ({ maxDistance = 48, count = 128 } = {}) => positions
      .filter(pos => pos.distanceTo(bot.entity.position) <= maxDistance)
      .slice(0, count)
      .map(pos => pos),
    blockAt: pos => blocks.find(block => block.position.equals(pos)) || null,
    tool: {
      equipped: [],
      async equipForBlock (block) { this.equipped.push(block.name) }
    },
    digs: [],
    async dig (block) {
      if (failWith) throw failWith
      bot.digs.push(block)
    },
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
      gotoCalls: 0,
      async goto () {
        this.gotoCalls++
        if (failWith) throw failWith
      },
      stop () { this.stops++ },
      setMovements (movements) { this.movements = movements }
    },
    clearControlStates () {}
  }
  return bot
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

test('ore di samping bot langsung dihancurkan tanpa pathfinding, movements gather tetap dipasang', async () => {
  const positions = [new Vec3(1, 64, 0)]
  const bot = fakeBot(positions)

  const result = await mineItem(bot, mcData, fakeMaterials(), 'coal', 4, {
    logger: silentLogger,
    allowHandMining: true,
    movementOptions: {
      allowTower: true,
      towerBlocks: ['dirt', 'cobblestone']
    }
  })

  assert.equal(result.blocks, 1)
  assert.equal(bot.digs.length, 1, 'blok dalam jangkauan digali langsung')
  assert.equal(bot.pathfinder.gotoCalls, 0, 'tidak perlu berjalan ke blok yang sudah terjangkau')
  assert.equal(bot.collectBlock.calls, 0, 'collectBlock tidak dipakai lagi untuk blok dekat')
  assert.deepEqual(bot.tool.equipped, ['coal_ore'], 'tool dipilih sebelum menggali')

  const movements = bot.pathfinder.movements
  assert.ok(movements, 'movements gather harus dipasang untuk berjalan ke blok jauh')
  assert.equal(movements.allow1by1towers, true)
  const scaffoldNames = movements.scafoldingBlocks.map(id => mcData.items[id].name)
  assert.ok(scaffoldNames.includes('dirt'))
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
    allowHandMining: true,
    digTimeoutMs: 200
  })

  assert.equal(result.reason, 'unreachable')
  assert.equal(result.mined, 0)
  assert.equal(bot.digs.length, 0)
  assert.equal(bot.pathfinder.gotoCalls, 4, 'satu percobaan jalan per blok, bukan berulang-ulang')
  assert.ok(bot.pathfinder.stops >= 1, 'pathfinder dihentikan agar tidak macet')
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
    tool: {
      async equipForBlock () {}
    },
    digs: [],
    async dig (block) {
      bot.digs.push(block)
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

  assert.ok(bot.pathfinder.gotoCalls >= 1, 'bot harus menuju cave lebih dulu')
  assert.ok(bot.digs.length >= 1, 'ore di cave digali langsung setelah sampai')
  assert.ok(bot.digs[0].position.x >= 8, 'ore pertama yang digali ada di area cave')
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
