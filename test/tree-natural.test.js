'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const Vec3 = require('vec3')
const { isNaturalTree, isBuildingBlockName } = require('../src/materials/tree')

function fakeWorld (blocks) {
  const world = new Map()
  for (const [key, name] of Object.entries(blocks)) world.set(key, name)
  return {
    blockAt (pos) {
      const name = world.get(`${pos.x},${pos.y},${pos.z}`)
      return name ? { name, position: pos } : { name: 'air', position: pos }
    },
    findBlocks ({ matching, point, maxDistance = 6 }) {
      const out = []
      for (const [key, name] of world) {
        if (!matching.includes(name)) continue
        const [x, y, z] = key.split(',').map(Number)
        const pos = new Vec3(x, y, z)
        if (pos.distanceTo(point) <= maxDistance) out.push(pos)
      }
      return out
    }
  }
}

function tree (blocks) {
  const ys = blocks.map(b => b.y)
  return {
    id: 'tree-1',
    blocks,
    size: blocks.length,
    center: new Vec3(0, Math.min(...ys), 0),
    base: new Vec3(0, Math.min(...ys), 0),
    height: Math.max(...ys) - Math.min(...ys) + 1
  }
}

test('isBuildingBlockName mengenali material rumah', () => {
  assert.equal(isBuildingBlockName('oak_planks'), true)
  assert.equal(isBuildingBlockName('oak_door'), true)
  assert.equal(isBuildingBlockName('glass_pane'), true)
  assert.equal(isBuildingBlockName('cobblestone'), true)
  assert.equal(isBuildingBlockName('oak_log'), false)
  assert.equal(isBuildingBlockName('oak_leaves'), false)
  assert.equal(isBuildingBlockName('grass_block'), false)
})

test('pohon berdaun dianggap pohon sungguhan', () => {
  const bot = fakeWorld({
    '0,63,0': 'grass_block',
    '0,64,0': 'oak_log',
    '0,65,0': 'oak_log',
    '0,66,0': 'oak_log',
    '1,67,0': 'oak_leaves'
  })
  const t = tree([new Vec3(0, 64, 0), new Vec3(0, 65, 0), new Vec3(0, 66, 0)])
  assert.equal(isNaturalTree(bot, t), true)
})

test('tiang log rumah village tanpa daun ditolak', () => {
  const bot = fakeWorld({
    '0,63,0': 'cobblestone',
    '0,64,0': 'oak_log',
    '0,65,0': 'oak_log',
    '0,66,0': 'oak_log',
    '1,64,0': 'oak_planks',
    '1,65,0': 'oak_planks',
    '0,66,1': 'glass_pane'
  })
  const t = tree([new Vec3(0, 64, 0), new Vec3(0, 65, 0), new Vec3(0, 66, 0)])
  assert.equal(isNaturalTree(bot, t), false)
})

test('log di atas tanah tanpa material bangunan tetap dianggap pohon', () => {
  const bot = fakeWorld({
    '0,63,0': 'grass_block',
    '0,64,0': 'oak_log',
    '0,65,0': 'oak_log',
    '0,66,0': 'oak_log'
  })
  const t = tree([new Vec3(0, 64, 0), new Vec3(0, 65, 0), new Vec3(0, 66, 0)])
  assert.equal(isNaturalTree(bot, t), true)
})

test('batang pendek tanpa daun di tanah ditolak (sisa bangunan)', () => {
  const bot = fakeWorld({
    '0,63,0': 'grass_block',
    '0,64,0': 'oak_log',
    '1,64,0': 'oak_fence'
  })
  const t = tree([new Vec3(0, 64, 0)])
  assert.equal(isNaturalTree(bot, t), false)
})

test('naturalOnly=false selalu menerima', () => {
  const bot = fakeWorld({
    '0,63,0': 'cobblestone',
    '0,64,0': 'oak_log',
    '1,64,0': 'oak_planks'
  })
  const t = tree([new Vec3(0, 64, 0)])
  assert.equal(isNaturalTree(bot, t, { naturalOnly: false }), true)
})
