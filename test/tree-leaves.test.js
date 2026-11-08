'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const Vec3 = require('vec3')

const {
  isLogName,
  isLeafName,
  saplingNameFor,
  lineLeafBlocks,
  chopTree,
  collectDrops,
  nearbyDrops,
  replantTree,
  plantGroups,
  trunkWidth,
  gatherLogs,
  TreeClaims
} = require('../src/materials/tree')

const silentLogger = { info () {}, debug () {}, warn () {}, error () {} }

const LOG_ID = 7
const LEAF_ID = 18
const SAPLING_ID = 31
const DIRT_ID = 3

const MC = {
  blocksByName: { dark_oak_log: { id: LOG_ID } },
  itemsByName: {
    dark_oak_log: { id: LOG_ID, name: 'dark_oak_log', stackSize: 64 },
    dark_oak_sapling: { id: SAPLING_ID, name: 'dark_oak_sapling', stackSize: 64 }
  }
}

function key (pos) {
  return `${pos.x},${pos.y},${pos.z}`
}

function logBlock (pos) {
  return { name: 'dark_oak_log', type: LOG_ID, position: pos.clone(), boundingBox: 'block' }
}

function leafBlock (pos) {
  return { name: 'dark_oak_leaves', type: LEAF_ID, position: pos.clone(), boundingBox: 'block' }
}

function soilBlock (pos) {
  return { name: 'dirt', type: DIRT_ID, position: pos.clone(), boundingBox: 'block' }
}

function airBlock (pos) {
  return { name: 'air', type: 0, position: pos.clone(), boundingBox: 'empty' }
}

// Bot palsu: menolak menebang log kalau masih ada daun di garis pandangnya
// (persis kasus "log di dalam kanopi dark oak"), tapi bisa membuka daun itu.
function makeBot ({ origin = new Vec3(0, 70, 2), world = new Map(), inventory = [] } = {}) {
  const bot = {
    username: 'bot',
    health: 20,
    entity: { position: origin.clone() },
    entities: {},
    inventory: { items: () => inventory, emptySlotCount: () => 12 },
    world,
    inventoryItems: inventory,
    gotoCalls: 0,
    dug: [],
    dropOnDig: false,
    dropSeq: 0,
    blockAt (pos) {
      return world.get(key(pos)) || null
    },
    findBlocks () {
      return [...world.values()].map(block => block.position)
    },
    async dig (block) {
      if (isLogName(block.name) && lineLeafBlocks(bot, block).length > 0) {
        throw new Error('unreachable')
      }
      world.delete(key(block.position))
      bot.dug.push(block.position.clone())
      if (isLogName(block.name)) {
        if (bot.dropOnDig) {
          // Seperti server asli: log jadi item entity di tanah, inventory baru
          // bertambah setelah item itu diambil.
          const id = `drop-${++bot.dropSeq}`
          bot.entities[id] = {
            position: block.position.offset(0.5, 0.2, 0.5),
            getDroppedItem: () => ({ type: block.type })
          }
        } else {
          inventory.push({ name: block.name, type: block.type, count: 1 })
        }
      }
    },
    async placeBlock (refBlock, face) {
      const target = refBlock.position.offset(face.x, face.y, face.z)
      world.set(key(target), { name: 'dark_oak_sapling', type: SAPLING_ID, position: target.clone(), boundingBox: 'empty' })
      const item = inventory.find(entry => entry.name === 'dark_oak_sapling')
      if (item) {
        item.count -= 1
        if (item.count <= 0) inventory.splice(inventory.indexOf(item), 1)
      }
      return true
    },
    async equip (item) { bot.heldItem = item },
    heldItem: null,
    setControlState () {},
    async lookAt () {},
    pathfinder: {
      async goto (goal) {
        bot.gotoCalls++
        bot.entity.position = new Vec3(goal.x, goal.y, goal.z)
        // Item yang sudah disentuh langsung terangkat (entity hilang).
        for (const [id, entity] of Object.entries(bot.entities)) {
          if (entity.position.distanceTo(bot.entity.position) > 1) continue
          const dropped = entity.getDroppedItem?.()
          if (dropped) inventory.push({ name: 'dark_oak_log', type: dropped.type, count: 1 })
          delete bot.entities[id]
        }
      },
      stop () {}
    }
  }
  return bot
}

// Kanopi pekat: semua blok di sekitar batang (radius 1) adalah daun.
function canopyWorld (levels = [70, 71, 72]) {
  const world = new Map()
  const logs = levels.map(y => new Vec3(0, y, 0))
  for (const pos of logs) world.set(key(pos), logBlock(pos))
  for (let y = levels[0]; y <= levels[levels.length - 1] + 1; y++) {
    for (let x = -1; x <= 1; x++) {
      for (let z = -1; z <= 1; z++) {
        const pos = new Vec3(x, y, z)
        if (logs.some(log => log.equals(pos))) continue
        world.set(key(pos), leafBlock(pos))
      }
    }
  }
  return { world, logs }
}

test('isLeafName mengenali daun, saplingNameFor memetakan log ke sapling', () => {
  assert.equal(isLeafName('dark_oak_leaves'), true)
  assert.equal(isLeafName('minecraft:oak_leaves'), true)
  assert.equal(isLeafName('nether_wart_block'), true)
  assert.equal(isLeafName('dark_oak_log'), false)

  assert.equal(saplingNameFor('dark_oak_log'), 'dark_oak_sapling')
  assert.equal(saplingNameFor('minecraft:oak_log'), 'oak_sapling')
  assert.equal(saplingNameFor('birch_wood'), 'birch_sapling')
  assert.equal(saplingNameFor('crimson_stem'), 'crimson_fungus')
})

test('lineLeafBlocks menemukan daun yang menghalangi pandangan ke log', () => {
  const { world } = canopyWorld()
  const bot = makeBot({ world })
  const target = bot.blockAt(new Vec3(0, 72, 0))
  const leaves = lineLeafBlocks(bot, target)
  assert.ok(leaves.length > 0, 'harus ada daun di garis pandang')
  assert.ok(leaves.every(leaf => isLeafName(leaf.name)))
})

test('chopTree membuka daun kanopi dan tetap menebang log di dalamnya', async () => {
  const { world, logs } = canopyWorld()
  const bot = makeBot({ world })
  const tree = { id: 't1', blocks: logs, size: logs.length, height: logs.length, minY: 70 }

  const result = await chopTree(bot, MC, tree, { logger: silentLogger })

  assert.equal(result.chopped, 3, 'semua log harus ditebang')
  assert.ok(result.leaves > 0, 'daun penghalang harus dibuka dulu')
  assert.equal(result.reason, null)
  assert.equal(world.get(key(new Vec3(0, 72, 0))), undefined)
})

test('chopTree tidak macet karena blok yang sudah hilang dari pohon', async () => {
  const world = new Map()
  const logs = [new Vec3(0, 70, 0), new Vec3(0, 71, 0)]
  for (const pos of logs) world.set(key(pos), logBlock(pos))
  // Blok ketiga sudah ditebang bot lain: masih tercatat di daftar pohon lama.
  const ghost = new Vec3(0, 72, 0)
  const bot = makeBot({ world })
  const tree = { id: 't2', blocks: [...logs, ghost], size: 3, height: 3, minY: 70 }

  const started = Date.now()
  const result = await chopTree(bot, MC, tree, { logger: silentLogger })

  assert.equal(result.chopped, 2)
  assert.equal(result.gone, 1)
  assert.equal(result.skipped, 0, 'blok hantu bukan kegagalan menambang')
  assert.equal(result.reason, null)
  assert.ok(Date.now() - started < 2000, 'tidak boleh menunggu lama untuk blok hantu')
})

test('chopTree berhenti dengan alasan stuck kalau bot tidak bisa bergerak sama sekali', async () => {
  const { world, logs } = canopyWorld()
  const bot = makeBot({ world })
  // Semua penambangan gagal (mis. wilayah terproteksi) dan tidak ada daun.
  bot.dig = async () => { throw new Error('protected') }
  const tree = { id: 't3', blocks: logs, size: logs.length, height: logs.length, minY: 70 }

  const result = await chopTree(bot, MC, tree, { logger: silentLogger, stuckMs: 60, maxFailures: 99 })

  assert.equal(result.chopped, 0)
  assert.ok(['stuck', 'protected', 'unreachable'].includes(result.reason), `reason tak terduga: ${result.reason}`)
})

test('nearbyDrops hanya mengambil item yang diminta dan mengabaikan yang jauh', () => {
  const bot = makeBot()
  bot.entities = {
    1: { position: new Vec3(2, 70, 2), getDroppedItem: () => ({ type: LOG_ID }) },
    2: { position: new Vec3(3, 70, 3), getDroppedItem: () => ({ type: DIRT_ID }) },
    3: { position: new Vec3(40, 70, 40), getDroppedItem: () => ({ type: LOG_ID }) },
    4: { position: new Vec3(0, 70, 0) } // zombie, bukan item
  }
  const drops = nearbyDrops(bot, { radius: 12, ids: new Set([LOG_ID]) })
  assert.equal(drops.length, 1)
  assert.equal(drops[0].position.x, 2)
})

test('collectDrops mendekati setiap log di tanah sampai terangkat', async () => {
  const bot = makeBot()
  bot.entities = {
    1: { position: new Vec3(2, 70, 2), getDroppedItem: () => ({ type: LOG_ID }) },
    2: { position: new Vec3(4, 70, 4), getDroppedItem: () => ({ type: LOG_ID }) },
    3: { position: new Vec3(5, 70, 5), getDroppedItem: () => ({ type: DIRT_ID }) }
  }

  const visited = await collectDrops(bot, MC, {
    itemNames: ['dark_oak_log'],
    radius: 12,
    logger: silentLogger
  })

  assert.equal(visited, 2)
  assert.equal(bot.gotoCalls, 2)
  assert.deepEqual(Object.keys(bot.entities), ['3'], 'hanya item non-log yang tersisa')
})

test('plantGroups menemukan kotak 2x2 untuk sapling dark oak', () => {
  const world = new Map()
  for (let x = 0; x <= 1; x++) {
    for (let z = 0; z <= 1; z++) {
      world.set(key(new Vec3(x, 69, z)), soilBlock(new Vec3(x, 69, z)))
      world.set(key(new Vec3(x, 70, z)), airBlock(new Vec3(x, 70, z)))
      world.set(key(new Vec3(x, 71, z)), airBlock(new Vec3(x, 71, z)))
    }
  }
  const bot = makeBot({ world })
  const tree = { id: 't4', blocks: [0, 1].flatMap(x => [0, 1].map(z => new Vec3(x, 70, z))) }

  assert.equal(trunkWidth(tree), 2)
  const groups = plantGroups(bot, tree, { size: 2, radius: 1 })
  assert.equal(groups.length, 1)
  assert.equal(groups[0].length, 4)
})

test('replantTree menanam 4 sapling dark oak setelah pohon ditebang', async () => {
  const world = new Map()
  for (let x = 0; x <= 1; x++) {
    for (let z = 0; z <= 1; z++) {
      world.set(key(new Vec3(x, 69, z)), soilBlock(new Vec3(x, 69, z)))
    }
  }
  const inventory = [{ name: 'dark_oak_sapling', type: SAPLING_ID, count: 4 }]
  const bot = makeBot({ world, inventory })
  const tree = { id: 't5', blocks: [0, 1].flatMap(x => [0, 1].map(z => new Vec3(x, 70, z))) }

  const result = await replantTree(bot, MC, tree, 'dark_oak_log', { logger: silentLogger })

  assert.equal(result.planted, 4)
  assert.equal(result.sapling, 'dark_oak_sapling')
  for (let x = 0; x <= 1; x++) {
    for (let z = 0; z <= 1; z++) {
      const planted = world.get(key(new Vec3(x, 70, z)))
      assert.equal(planted?.name, 'dark_oak_sapling', `sapling harus ada di ${x},70,${z}`)
    }
  }
  assert.equal(inventory.length, 0, 'sapling terpakai habis')
})

test('replantTree tidak menanam setengah-setengah kalau sapling kurang dari 4', async () => {
  const world = new Map()
  for (let x = 0; x <= 1; x++) {
    for (let z = 0; z <= 1; z++) world.set(key(new Vec3(x, 69, z)), soilBlock(new Vec3(x, 69, z)))
  }
  const inventory = [{ name: 'dark_oak_sapling', type: SAPLING_ID, count: 2 }]
  const bot = makeBot({ world, inventory })
  const tree = { id: 't6', blocks: [0, 1].flatMap(x => [0, 1].map(z => new Vec3(x, 70, z))) }

  const result = await replantTree(bot, MC, tree, 'dark_oak_log', { logger: silentLogger })

  assert.equal(result.planted, 0)
  assert.equal(result.reason, 'not-enough-saplings')
})

test('replantTree menanam satu sapling untuk pohon 1x1 (oak)', async () => {
  const world = new Map()
  world.set(key(new Vec3(0, 69, 0)), soilBlock(new Vec3(0, 69, 0)))
  const inventory = [{ name: 'dark_oak_sapling', type: SAPLING_ID, count: 1 }]
  const bot = makeBot({ world, inventory })
  const tree = { id: 't7', blocks: [new Vec3(0, 70, 0)] }

  const result = await replantTree(bot, MC, tree, 'dark_oak_log', { logger: silentLogger })

  assert.equal(result.planted, 1)
  assert.equal(world.get(key(new Vec3(0, 70, 0)))?.name, 'dark_oak_sapling')
})

test('gatherLogs mengambil log dari tanah sehingga kuota terpenuhi', async () => {
  const world = new Map()
  const logs = [new Vec3(0, 70, 0), new Vec3(0, 71, 0), new Vec3(0, 72, 0)]
  for (const pos of logs) world.set(key(pos), logBlock(pos))
  const inventory = []
  const bot = makeBot({ world, inventory })
  bot.dropOnDig = true

  const result = await gatherLogs(bot, MC, null, 'dark_oak_log', 3, {
    logger: silentLogger,
    tree: { minTreeSize: 1, scanRadius: 16, maxScanRadius: 16, waitMs: 10, replant: false, naturalOnly: false },
    claims: new TreeClaims()
  })

  assert.equal(result.blocks, 3)
  assert.equal(result.mined, 3, 'tiga log harus sudah ada di inventory')
  assert.equal(result.have, 3)
  assert.equal(result.drops, 3)
  assert.equal(Object.keys(bot.entities).length, 0, 'tidak ada log tertinggal di tanah')
})

test('gatherLogs hanya menebang pohon asli, bukan tiang rumah village', async () => {
  const world = new Map()
  // Pohon asli: tanah di bawah, daun di atas.
  for (let y = 70; y <= 72; y++) world.set(key(new Vec3(0, y, 0)), logBlock(new Vec3(0, y, 0)))
  world.set('0,69,0', soilBlock(new Vec3(0, 69, 0)))
  world.set('0,73,0', leafBlock(new Vec3(0, 73, 0)))
  // Tiang rumah: fondasi batu, papan di samping, tanpa daun.
  for (let y = 70; y <= 72; y++) world.set(key(new Vec3(10, y, 0)), logBlock(new Vec3(10, y, 0)))
  world.set('10,69,0', { name: 'cobblestone', type: 4, position: new Vec3(10, 69, 0), boundingBox: 'block' })
  world.set('11,70,0', { name: 'oak_planks', type: 5, position: new Vec3(11, 70, 0), boundingBox: 'block' })

  const bot = makeBot({ world, inventory: [] })
  const result = await gatherLogs(bot, MC, null, 'dark_oak_log', 3, {
    logger: silentLogger,
    tree: { minTreeSize: 1, scanRadius: 24, maxScanRadius: 24, waitMs: 10, replant: false },
    claims: new TreeClaims()
  })

  assert.equal(result.blocks, 3, 'hanya tiga log pohon yang ditebang')
  for (let y = 70; y <= 72; y++) {
    assert.equal(world.get(key(new Vec3(10, y, 0)))?.name, 'dark_oak_log', 'tiang rumah tidak disentuh')
  }
})
