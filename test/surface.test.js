'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const Vec3 = require('vec3')
const {
  isCovered,
  isSurfaceTarget,
  createSurfaceExclusion,
  applySurfaceExclusion
} = require('../src/navigation/surface')

function key (pos) {
  return `${pos.x},${pos.y},${pos.z}`
}

function solid (pos, name = 'stone') {
  return { name, position: pos.clone(), boundingBox: 'block' }
}

function fakeBot (blocks, position = new Vec3(0, 64, 0)) {
  const map = new Map(blocks.map(block => [key(block.position), block]))
  return {
    entity: { position },
    blockAt (pos) {
      return map.get(key(pos)) || { name: 'air', boundingBox: 'empty', position: pos.clone() }
    }
  }
}

test('isCovered detects roof blocks but ignores leaves', () => {
  const position = new Vec3(0, 64, 0)
  const roofed = fakeBot([solid(new Vec3(0, 65, 0))])
  const leaves = fakeBot([solid(new Vec3(0, 65, 0), 'oak_leaves')])

  assert.equal(isCovered(roofed, position, 2), true)
  assert.equal(isCovered(leaves, position, 2), false)
})

test('isSurfaceTarget requires a roof-free column with a floor', () => {
  const target = new Vec3(0, 64, 0)
  const surface = fakeBot([solid(new Vec3(0, 63, 0))])
  const covered = fakeBot([
    solid(new Vec3(0, 63, 0)),
    solid(new Vec3(0, 65, 0))
  ])
  const voidTarget = fakeBot([])

  assert.equal(isSurfaceTarget(surface, target, { coverScanHeight: 2 }), true)
  assert.equal(isSurfaceTarget(covered, target, { coverScanHeight: 2 }), false)
  assert.equal(isSurfaceTarget(voidTarget, target, { coverScanHeight: 2 }), false)
})

test('surface exclusion penalizes covered steps and deep descents', () => {
  const target = new Vec3(0, 70, 0)
  const bot = fakeBot([solid(new Vec3(0, 69, 0))], new Vec3(0, 64, 0))
  const exclusion = createSurfaceExclusion(bot, target, {
    coverScanHeight: 2,
    maxDescent: 2,
    verticalThreshold: 4
  })

  assert.equal(exclusion({ position: new Vec3(0, 61, 0) }), 100)
  assert.equal(exclusion({ position: new Vec3(0, 63, 0) }), 0)
})

test('applySurfaceExclusion installs a cost function only for surface targets', () => {
  const target = new Vec3(0, 64, 0)
  const bot = fakeBot([solid(new Vec3(0, 63, 0))])
  const movements = { exclusionAreasStep: [] }

  assert.equal(applySurfaceExclusion(movements, bot, target, { surfaceBias: true }), true)
  assert.equal(movements.exclusionAreasStep.length, 1)

  const coveredBot = fakeBot([
    solid(new Vec3(0, 63, 0)),
    solid(new Vec3(0, 65, 0))
  ])
  const covered = { exclusionAreasStep: [] }
  assert.equal(applySurfaceExclusion(covered, coveredBot, target, { surfaceBias: true }), false)
  assert.equal(covered.exclusionAreasStep.length, 0)
})
