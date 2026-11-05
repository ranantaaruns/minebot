'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const Vec3 = require('vec3')

const {
  isLogName,
  clusterLogs,
  orderTopDown,
  TreeClaims,
  pickTree,
  discoverTrees,
  chopTree,
  gatherLogs
} = require('../src/materials/tree')

const silentLogger = { info () {}, debug () {}, warn () {}, error () {} }
const LOG_ID = 7
const MC = {
  blocksByName: { dark_oak_log: { id: LOG_ID } },
  itemsByName: { dark_oak_log: { id: LOG_ID, name: 'dark_oak_log' } }
}

function key (pos) {
  return `${pos.x},${pos.y},${pos.z}`
}

function makeBlock (pos) {
  return { name: 'dark_oak_log', type: LOG_ID, position: new Vec3(pos.x, pos.y, pos.z), boundingBox: 'block' }
}

// Dunia mini: hanya blok log yang tercatat, sisanya dianggap udara.
function makeWorld (positions) {
  const world = new Map()
  for (const pos of positions) world.set(key(pos), makeBlock(pos))
  return world
}

function trunk (x, z, levels, baseY = 70) {
  const out = []
  for (let dy = 0; dy < levels; dy++) {
    for (let dx = 0; dx < 2; dx++) {
      for (let dz = 0; dz < 2; dz++) {
        out.push(new Vec3(x + dx, baseY + dy, z + dz))
      }
    }
  }
  return out
}

function makeBot (world, origin, username = 'bot') {
  const inventory = []
  const dug = []
  return {
    username,
    health: 20,
    entity: { position: origin.clone() },
    inventory: { items: () => inventory, emptySlotCount: () => 12 },
    dug,
    blockAt (pos) {
      return world.get(key(pos)) || null
    },
    findBlocks ({ maxDistance = 64 } = {}) {
      return [...world.values()]
        .filter(block => block.position.distanceTo(origin) <= maxDistance)
        .map(block => block.position)
    },
    async dig (block) {
      world.delete(key(block.position))
      inventory.push({ name: 'dark_oak_log', type: LOG_ID, count: 1 })
      dug.push(block.position.clone())
    }
  }
}

test('isLogName hanya benar untuk log/wood/stem', () => {
  assert.equal(isLogName('dark_oak_log'), true)
  assert.equal(isLogName('minecraft:dark_oak_log'), true)
  assert.equal(isLogName('stripped_oak_wood'), true)
  assert.equal(isLogName('mangrove_roots'), false)
  assert.equal(isLogName('dark_oak_planks'), false)
  assert.equal(isLogName('oak_log_door'), false)
})

test('clusterLogs memisahkan dua pohon yang berdampingan', () => {
  const trees = clusterLogs([...trunk(0, 0, 2), ...trunk(10, 0, 3)])
  assert.equal(trees.length, 2)

  const sizes = trees.map(tree => tree.size).sort((a, b) => a - b)
  assert.deepEqual(sizes, [8, 12])

  const heights = trees.map(tree => tree.height).sort((a, b) => a - b)
  assert.deepEqual(heights, [2, 3])
  assert.notEqual(trees[0].id, trees[1].id)
})

test('clusterLogs menggabungkan cabang yang bersentuhan dalam satu pohon', () => {
  const logs = [
    ...trunk(0, 0, 4),
    new Vec3(2, 73, 0),
    new Vec3(3, 73, 0)
  ]
  const trees = clusterLogs(logs)
  assert.equal(trees.length, 1)
  assert.equal(trees[0].size, logs.length)
})

test('id pohon tetap walau bagian atasnya sudah ditebang', () => {
  const before = clusterLogs(trunk(5, 5, 5))[0]
  const after = clusterLogs(trunk(5, 5, 5).filter(pos => pos.y <= 72))[0]
  assert.equal(before.id, after.id)
})

test('orderTopDown menebang dari puncak lalu yang terdekat', () => {
  const blocks = [...trunk(0, 0, 4)]
  const ordered = orderTopDown(blocks, new Vec3(4, 70, 4))
  assert.equal(ordered[0].y, 73)
  assert.equal(ordered[ordered.length - 1].y, 70)
  for (let i = 1; i < ordered.length; i++) {
    assert.ok(ordered[i - 1].y >= ordered[i].y)
  }
})

test('TreeClaims: satu pohon hanya boleh diklaim satu bot', () => {
  const claims = new TreeClaims({ ttlMs: 1000 })
  assert.equal(claims.claim('t1', 'bot1', 1000), true)
  assert.equal(claims.claim('t1', 'bot2', 1000), false)
  assert.equal(claims.isClaimedByOther('t1', 'bot2', 1000), true)
  assert.equal(claims.isClaimedByOther('t1', 'bot1', 1000), false)

  assert.equal(claims.release('t1', 'bot2'), false)
  assert.equal(claims.claim('t1', 'bot2', 1000), false)
  assert.equal(claims.release('t1', 'bot1'), true)
  assert.equal(claims.claim('t1', 'bot2', 1001), true)
})

test('TreeClaims melepas klaim yang kedaluwarsa', () => {
  const claims = new TreeClaims({ ttlMs: 500 })
  claims.claim('t1', 'bot1', 0)
  assert.equal(claims.isClaimedByOther('t1', 'bot2', 100), true)
  assert.equal(claims.isClaimedByOther('t1', 'bot2', 900), false)
})

test('pickTree menyebar 3 bot ke 3 pohon berbeda', () => {
  const trees = clusterLogs([
    ...trunk(0, 0, 3),
    ...trunk(20, 0, 3),
    ...trunk(40, 0, 3)
  ])
  const claims = new TreeClaims()
  const origin = new Vec3(0, 70, 0)
  const taken = []

  for (const owner of ['bot1', 'bot2', 'bot3']) {
    const picked = pickTree(trees, { origin, claims, ownerId: owner })
    assert.ok(picked, `bot ${owner} harus dapat pohon`)
    assert.equal(claims.claim(picked.tree.id, owner), true)
    taken.push(picked.tree.id)
  }

  assert.equal(new Set(taken).size, 3)
})

test('pickTree mengembalikan null kalau semua pohon sudah diklaim bot lain', () => {
  const trees = clusterLogs(trunk(0, 0, 3))
  const claims = new TreeClaims()
  claims.claim(trees[0].id, 'bot1')
  assert.equal(pickTree(trees, { origin: new Vec3(0, 70, 0), claims, ownerId: 'bot2' }), null)
})

test('discoverTrees menyaring blok di luar batas Y dan sekitar origin', () => {
  const world = makeWorld([...trunk(0, 0, 2), new Vec3(0, 5, 0)])
  const bot = makeBot(world, new Vec3(3, 70, 3))
  const trees = discoverTrees(bot, [LOG_ID], { radius: 32, mineYMin: 60, mineYMax: 160 })
  assert.equal(trees.length, 1)
  assert.equal(trees[0].minY, 70)

  const protectedTrees = discoverTrees(bot, [LOG_ID], {
    radius: 32,
    protectOrigin: new Vec3(0, 70, 0),
    protectRadius: 8
  })
  assert.equal(protectedTrees.length, 0)
})

test('chopTree menebang 12 blok dari puncak ke bawah', async () => {
  const positions = trunk(0, 0, 3)
  const world = makeWorld(positions)
  const bot = makeBot(world, new Vec3(3, 70, 3))
  const tree = clusterLogs(positions)[0]

  const result = await chopTree(bot, MC, tree, { logger: silentLogger })

  assert.equal(result.chopped, 12)
  assert.equal(bot.dug.length, 12)
  assert.equal(world.size, 0)
  assert.equal(bot.dug[0].y, 72)
  for (let i = 1; i < bot.dug.length; i++) {
    assert.ok(bot.dug[i - 1].y >= bot.dug[i].y, 'urutan tebang harus dari atas ke bawah')
  }
})

test('chopTree berhenti rapi kalau puncak tidak terjangkau dan tidak bisa naik', async () => {
  const positions = trunk(0, 0, 10)
  const world = makeWorld(positions)
  const origin = new Vec3(3, 70, 3)
  const bot = makeBot(world, origin)
  const tree = clusterLogs(positions)[0]

  const reachable = positions.filter(pos =>
    origin.offset(0, 1.62, 0).distanceTo(new Vec3(pos.x + 0.5, pos.y + 0.5, pos.z + 0.5)) <= 4.3
  )

  const result = await chopTree(bot, MC, tree, { logger: silentLogger, maxFailures: 4 })

  assert.equal(result.chopped, reachable.length, 'semua blok terjangkau ditebang')
  assert.ok(result.chopped < positions.length)
  assert.equal(result.reason, 'unreachable')
  assert.equal(result.climbs, 0)

  const reachableKeys = new Set(reachable.map(key))
  for (const pos of bot.dug) assert.ok(reachableKeys.has(key(pos)), 'tidak menebang blok di luar jangkauan')
})

test('gatherLogs: dua bot berbagi klaim sehingga masing-masing menebang pohon sendiri', async () => {
  const positions = [...trunk(0, 0, 2), ...trunk(12, 0, 2)]
  const world = makeWorld(positions)
  const claims = new TreeClaims()
  const claimedBy = []

  const originalClaim = claims.claim.bind(claims)
  claims.claim = (treeId, ownerId, now) => {
    const ok = originalClaim(treeId, ownerId, now)
    if (ok) claimedBy.push({ treeId, ownerId })
    return ok
  }

  const botA = makeBot(world, new Vec3(2, 70, 2), 'bot1')
  const botB = makeBot(world, new Vec3(14, 70, 2), 'bot2')

  const [resA, resB] = await Promise.all([
    gatherLogs(botA, MC, null, 'dark_oak_log', 8, { logger: silentLogger, claims, ownerId: 'bot1' }),
    gatherLogs(botB, MC, null, 'dark_oak_log', 8, { logger: silentLogger, claims, ownerId: 'bot2' })
  ])

  assert.equal(resA.have, 8)
  assert.equal(resB.have, 8)
  assert.equal(world.size, 0, 'kedua pohon habis ditebang')

  const firstA = claimedBy.find(entry => entry.ownerId === 'bot1')
  const firstB = claimedBy.find(entry => entry.ownerId === 'bot2')
  assert.ok(firstA && firstB)
  assert.notEqual(firstA.treeId, firstB.treeId, 'tiap bot mengklaim pohon yang berbeda')
})

test('gatherLogs berhenti dengan alasan not-found kalau tidak ada pohon', async () => {
  const world = makeWorld([])
  const bot = makeBot(world, new Vec3(0, 70, 0))
  const result = await gatherLogs(bot, MC, null, 'dark_oak_log', 32, { logger: silentLogger, claims: new TreeClaims() })
  assert.equal(result.mined, 0)
  assert.equal(result.reason, 'not-found')
})
