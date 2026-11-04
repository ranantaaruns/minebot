'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const Vec3 = require('vec3')
const { findCaves, isCaveCell, goToCave } = require('../src/navigation/cave')

const silentLogger = { info () {}, warn () {}, debug () {}, error () {} }
const EMPTY = new Set(['air', 'cave_air', 'void_air'])

// Dunia palsu: semua solid kecuali koordinat di `air` (daftar Vec3).
function caveBot ({ air = [], position = new Vec3(0, 32, 0) } = {}) {
  const airSet = new Set(air.map(p => `${p.x},${p.y},${p.z}`))
  const bot = {
    entity: { position },
    game: { dimension: 'minecraft:overworld' },
    blockAt (p) {
      if (airSet.has(`${p.x},${p.y},${p.z}`)) return { name: 'cave_air', boundingBox: 'empty' }
      return { name: 'stone', boundingBox: 'block' }
    },
    findBlocks ({ maxDistance, count }) {
      const found = air.filter(p => p.distanceTo(position) <= maxDistance)
      return found.slice(0, count)
    },
    pathfinder: {
      visited: [],
      async goto (goal) {
        this.visited.push(goal)
      }
    }
  }
  return bot
}

// Lorong cave: 3 blok tinggi, memanjang ke sumbu x
function caveTunnel ({ start = 6, length = 6, y = 30, z = 0 } = {}) {
  const air = []
  for (let x = start; x < start + length; x++) {
    for (let dy = 0; dy < 3; dy++) air.push(new Vec3(x, y + dy, z))
  }
  return air
}

test('isCaveCell menolak lubang 1 blok dan menerima lorong cave', () => {
  const pocket = [new Vec3(4, 30, 0), new Vec3(4, 31, 0)]
  const bot = caveBot({ air: pocket })
  assert.equal(isCaveCell(bot, new Vec3(4, 30, 0)), false)

  const tunnel = caveBot({ air: caveTunnel() })
  assert.equal(isCaveCell(tunnel, new Vec3(6, 30, 0)), true)
})

test('isCaveCell menolak titik tanpa lantai padat', () => {
  const air = caveTunnel().filter(p => !(p.x === 7 && p.y === 30 && p.z === 0))
  const bot = caveBot({ air })
  assert.equal(isCaveCell(bot, new Vec3(7, 30, 0)), false)
})

test('findCaves mengurutkan kandidat dari yang terdekat', () => {
  const air = [...caveTunnel({ start: 20, length: 6 }), ...caveTunnel({ start: 6, length: 6 })]
  const bot = caveBot({ air })

  const caves = findCaves(bot, { radius: 48 })

  assert.ok(caves.length >= 2)
  assert.ok(caves[0].position.distanceTo(bot.entity.position) <= caves[caves.length - 1].position.distanceTo(bot.entity.position))
  assert.ok(caves[0].air >= 3, 'kandidat harus melaporkan jumlah udara terbuka')
})

test('findCaves mengabaikan cave di luar radius', () => {
  const bot = caveBot({ air: caveTunnel({ start: 200, length: 6 }) })
  assert.deepEqual(findCaves(bot, { radius: 48 }), [])
})

test('goToCave berjalan ke cave terdekat dan mengembalikan posisinya', async () => {
  const air = caveTunnel({ start: 10, length: 6 })
  const bot = caveBot({ air })

  const spot = await goToCave(bot, { radius: 48, logger: silentLogger })

  assert.ok(spot)
  assert.equal(bot.pathfinder.visited.length, 1)
  assert.ok(EMPTY)
})

test('goToCave mengembalikan null bila tidak ada cave', async () => {
  const bot = caveBot({ air: [] })
  const spot = await goToCave(bot, { radius: 48, logger: silentLogger })
  assert.equal(spot, null)
  assert.equal(bot.pathfinder.visited.length, 0)
})

test('goToCave mencoba kandidat berikutnya saat kandidat pertama tidak terjangkau', async () => {
  const air = [...caveTunnel({ start: 10, length: 6 }), ...caveTunnel({ start: 30, length: 6 })]
  const bot = caveBot({ air })
  let calls = 0
  bot.pathfinder.goto = async () => {
    calls++
    if (calls === 1) throw new Error('No path to the goal!')
  }

  const spot = await goToCave(bot, { radius: 48, logger: silentLogger })

  assert.ok(spot)
  assert.equal(calls, 2)
})
