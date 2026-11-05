'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const Vec3 = require('vec3')
const { closestApproach, horizontalPerp, timeToIntercept, tangentialIntercept, POST_HIT_PITCH } = require('../src/combat/charge')

const self = (x, y, z) => ({ position: new Vec3(x, y, z), velocity: new Vec3(0, 0, 0) })
const target = (x, y, z, vx = 0, vy = 0, vz = 0) => ({ position: new Vec3(x, y, z), velocity: new Vec3(vx, vy, vz), height: 1.8 })

test('horizontalPerp tegak lurus dan horizontal', () => {
  const p = horizontalPerp(new Vec3(1, 0, 0))
  assert.equal(p.y, 0)
  assert.ok(Math.abs(p.dot(new Vec3(1, 0, 0))) < 1e-6)
  assert.ok(Math.abs(p.norm() - 1) < 1e-6)
})

test('closestApproach jarak nol bila meluncur tepat ke titik', () => {
  const r = closestApproach(new Vec3(0, 64, 0), new Vec3(1, 0, 0), new Vec3(10, 64, 0))
  assert.ok(Math.abs(r.distance) < 1e-6)
})

test('timeToIntercept lebih besar untuk target jauh', () => {
  const near = timeToIntercept({ from: new Vec3(0, 64, 0), point: new Vec3(10, 64, 0), velocity: new Vec3(0, 0, 0), speed: 2 })
  const far = timeToIntercept({ from: new Vec3(0, 64, 0), point: new Vec3(30, 64, 0), velocity: new Vec3(0, 0, 0), speed: 2 })
  assert.ok(far.ticks > near.ticks)
  assert.ok(Math.abs(near.ticks - 5) < 0.01)
})

test('timeToIntercept mengejar target yang menjauh', () => {
  const r = timeToIntercept({ from: new Vec3(0, 64, 0), point: new Vec3(20, 64, 0), velocity: new Vec3(0.5, 0, 0), speed: 2 })
  assert.equal(r.ok, true)
  assert.ok(r.ticks > 10, `butuh lebih lama dari jarak/speed, dapat ${r.ticks}`)
})

test('deadzone: target 3 blok ditolak walau offset lateral', () => {
  const r = tangentialIntercept({ self: self(0, 64, 0), target: target(3, 64, 0), speed: 1.8 })
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'deadzone')
})

test('intersepsi 20 blok diterima dengan closest-approach di 2.2..3.8', () => {
  const r = tangentialIntercept({ self: self(0, 64, 0), target: target(20, 64, 0), speed: 2.0 })
  assert.equal(r.ok, true)
  assert.ok(r.closest >= 2.2 && r.closest <= 3.8, `closest=${r.closest}`)
  assert.ok(Math.abs(r.point.y - 64) < 0.001, 'target datar: titik bidik di Y yang sama')
})

test('offset lateral tidak pernah nol (anti head-on)', () => {
  const r = tangentialIntercept({ self: self(0, 64, 0), target: target(20, 64, 0), speed: 2.0 })
  assert.ok(Math.abs(r.lateral) >= 2.4, `lateral=${r.lateral}`)
})

test('target bergerak: titik bidik digeser ke depan', () => {
  const r = tangentialIntercept({ self: self(0, 64, 0), target: target(20, 64, 0, 0, 0, 0.6), speed: 2.0 })
  assert.equal(r.ok, true)
  assert.ok(Math.abs(r.point.z - 0) > 1, 'titik bidik harus bergeser di sumbu Z')
})

test('horizonTicks membatasi waktu tempuh', () => {
  const r = tangentialIntercept({ self: self(0, 64, 0), target: target(60, 64, 0), speed: 1.0, horizonTicks: 12 })
  assert.ok(r.ticks <= 12.0001)
})

test('POST_HIT_PITCH = -15 derajat', () => {
  assert.equal(POST_HIT_PITCH, -15)
})
