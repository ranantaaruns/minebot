'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  HORIZONTAL,
  rotateFacing,
  transformProperties,
  transformBlocks
} = require('../src/blueprint/transform')

function positions (blocks) {
  return blocks.map(b => `${b.x},${b.y},${b.z}`).sort()
}

test('HORIZONTAL mengikuti urutan searah jarum jam', () => {
  assert.deepEqual(HORIZONTAL, ['north', 'east', 'south', 'west'])
  assert.equal(rotateFacing('north', 90), 'east')
  assert.equal(rotateFacing('north', 180), 'south')
  assert.equal(rotateFacing('north', 270), 'west')
  assert.equal(rotateFacing('north', 360), 'north')
  assert.equal(rotateFacing('up', 90), 'up')
})

test('transformBlocks merotasi posisi searah jarum jam', () => {
  const blocks = [
    { x: 0, y: 0, z: 0, name: 'minecraft:stone', properties: {} },
    { x: 1, y: 0, z: 0, name: 'minecraft:stone', properties: {} }
  ]

  assert.deepEqual(positions(transformBlocks(blocks, { rotate: 90 })), ['0,0,0', '0,0,1'])
  assert.deepEqual(positions(transformBlocks(blocks, { rotate: 180 })), ['-1,0,0', '0,0,0'])
})

test('transformBlocks mencerminkan posisi pada sumbu x dan z', () => {
  const blocks = [
    { x: 0, y: 0, z: 0, name: 'minecraft:stone', properties: {} },
    { x: 1, y: 0, z: 0, name: 'minecraft:stone', properties: {} },
    { x: 0, y: 0, z: 1, name: 'minecraft:stone', properties: {} }
  ]

  // mirror x: x -> maxX - x, jadi (0,0,0)->(1,0,0), (1,0,0)->(0,0,0), (0,0,1)->(1,0,1)
  assert.deepEqual(
    positions(transformBlocks(blocks, { mirror: 'x' })),
    ['0,0,0', '1,0,0', '1,0,1']
  )
  // mirror z: z -> maxZ - z, jadi (0,0,1)->(0,0,0) dan (0,0,0)/(1,0,0)->(.,.,1)
  assert.deepEqual(
    positions(transformBlocks(blocks, { mirror: 'z' })),
    ['0,0,0', '0,0,1', '1,0,1']
  )

  const corner = [{ x: 0, y: 0, z: 0, name: 'minecraft:stone', properties: {} }]
  assert.deepEqual(positions(transformBlocks(corner, { mirror: 'x' })), ['0,0,0'])
})

test('transformProperties membalik facing, axis, dan hinge', () => {
  assert.equal(transformProperties({ facing: 'north' }, { rotate: 90 }).facing, 'east')
  assert.equal(transformProperties({ facing: 'east' }, { rotate: 180 }).facing, 'west')
  assert.equal(transformProperties({ facing: 'east' }, { mirror: 'x' }).facing, 'west')
  assert.equal(transformProperties({ facing: 'north' }, { mirror: 'z' }).facing, 'south')
  assert.equal(transformProperties({ facing: 'up' }, { mirror: 'z' }).facing, 'up')

  assert.equal(transformProperties({ axis: 'x' }, { rotate: 90 }).axis, 'z')
  assert.equal(transformProperties({ axis: 'z' }, { rotate: 180 }).axis, 'z')
  assert.equal(transformProperties({ axis: 'x' }, { rotate: 270 }).axis, 'z')
  assert.equal(transformProperties({ axis: 'y' }, { rotate: 90 }).axis, 'y')

  assert.equal(transformProperties({ hinge: 'left' }, { mirror: 'x' }).hinge, 'right')
  assert.equal(transformProperties({ hinge: 'left' }, { rotate: 90 }).hinge, 'left')
})

test('transformBlocks tidak mengubah input asli', () => {
  const blocks = [{ x: 0, y: 0, z: 0, name: 'minecraft:stone', properties: { facing: 'north' } }]
  const result = transformBlocks(blocks, { rotate: 90 })

  assert.equal(blocks[0].properties.facing, 'north')
  assert.equal(result[0].properties.facing, 'east')
})

test('transformBlocks menolak rotasi dan mirror yang tidak valid', () => {
  const blocks = [{ x: 0, y: 0, z: 0, name: 'minecraft:stone', properties: {} }]

  assert.throws(() => transformBlocks(blocks, { rotate: 45 }), /kelipatan 90/)
  assert.throws(() => transformBlocks(blocks, { mirror: 'y' }), /x atau z/)
})
