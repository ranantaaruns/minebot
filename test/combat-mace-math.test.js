'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const Vec3 = require('vec3')
const { inLaunchWindow, predictPosition, headPoint, shouldSmash, detectWindBurst, shouldClutch } = require('../src/combat/mace')

test('inLaunchWindow: jendela 4-10 blok, dy -1..+2, butuh mace + amunisi', () => {
  const base = { distance: 6, dy: 0, blocking: false, mace: true, ammo: 4 }
  assert.equal(inLaunchWindow(base), true)
  assert.equal(inLaunchWindow({ ...base, distance: 3.9 }), false, 'terlalu dekat')
  assert.equal(inLaunchWindow({ ...base, distance: 10.1 }), false, 'terlalu jauh')
  assert.equal(inLaunchWindow({ ...base, dy: -1.2 }), false, 'terlalu rendah')
  assert.equal(inLaunchWindow({ ...base, dy: 2.1 }), false, 'terlalu tinggi')
  assert.equal(inLaunchWindow({ ...base, blocking: true }), false, 'target pegang perisai')
  assert.equal(inLaunchWindow({ ...base, ammo: 0 }), false, 'tanpa wind charge')
  assert.equal(inLaunchWindow({ ...base, mace: false }), false, 'tanpa mace')
})

test('predictPosition ekstrapolasi linear', () => {
  const e = { position: new Vec3(0, 64, 0), velocity: new Vec3(0.2, 0, -0.1) }
  const p = predictPosition(e, 2)
  assert.ok(Math.abs(p.x - 0.4) < 1e-9)
  assert.ok(Math.abs(p.z + 0.2) < 1e-9)
})

test('headPoint memakai tinggi badan 0.85', () => {
  const e = { position: new Vec3(0, 64, 0), velocity: new Vec3(0, 0, 0), height: 1.8 }
  const p = headPoint(e, 1)
  assert.ok(Math.abs(p.y - (64 + 1.53)) < 1e-6)
})

test('shouldSmash butuh turun, fall >= 1.5, jarak <= 3.2', () => {
  assert.equal(shouldSmash({ distance: 3, velocityY: -0.4, fallDistance: 1.6 }), true)
  assert.equal(shouldSmash({ distance: 3, velocityY: 0.2, fallDistance: 1.6 }), false)
  assert.equal(shouldSmash({ distance: 3, velocityY: -0.4, fallDistance: 1.4 }), false)
  assert.equal(shouldSmash({ distance: 3.4, velocityY: -0.4, fallDistance: 1.6 }), false)
})

test('detectWindBurst: lonjakan positif tanpa menyentuh tanah', () => {
  assert.equal(detectWindBurst({ velocityY: 0.9, onGround: false, prevVelocityY: 0 }), true)
  assert.equal(detectWindBurst({ velocityY: 0.9, onGround: true, prevVelocityY: 0 }), false)
  assert.equal(detectWindBurst({ velocityY: -0.2, onGround: false, prevVelocityY: 0 }), false)
})

test('shouldClutch: fall > 3, tinggi <= 1.8, target di luar jangkauan', () => {
  assert.equal(shouldClutch({ distance: 9, fallDistance: 4, heightAbove: 1.2 }), true)
  assert.equal(shouldClutch({ distance: 2, fallDistance: 4, heightAbove: 1.2 }), false, 'target masih dekat')
  assert.equal(shouldClutch({ distance: 9, fallDistance: 2, heightAbove: 1.2 }), false)
  assert.equal(shouldClutch({ distance: 9, fallDistance: 4, heightAbove: 3 }), false)
})
