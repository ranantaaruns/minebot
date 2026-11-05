'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { horizontalDistance, bearingDeg, compassPoint, velocityFrom, predictPosition, formatCoords } = require('../src/intel/geo')

const samples = [
  { t: 0, x: 0, y: 64, z: 0 },
  { t: 1000, x: 4, y: 64, z: -4 },
  { t: 2000, x: 8, y: 64, z: -8 }
]

test('horizontalDistance mengabaikan Y', () => {
  assert.equal(horizontalDistance({ x: 0, y: 0, z: 0 }, { x: 3, y: 90, z: 4 }), 5)
})

test('bearingDeg 0 = utara, 90 = timur', () => {
  assert.equal(bearingDeg({ x: 0, z: 0 }, { x: 0, z: -10 }), 0)
  assert.equal(bearingDeg({ x: 0, z: 0 }, { x: 10, z: 0 }), 90)
})

test('compassPoint menerjemahkan bearing', () => {
  assert.equal(compassPoint(0), 'utara')
  assert.equal(compassPoint(90), 'timur')
  assert.equal(compassPoint(225), 'barat daya')
})

test('velocityFrom memakai selisih waktu nyata', () => {
  const v = velocityFrom(samples)
  assert.equal(v.x, 4)
  assert.equal(v.z, -4)
})

test('predictPosition mengekstrapolasi dan menandai ketidakpastian', () => {
  const p = predictPosition(samples, 5000)
  assert.equal(p.x, 28)
  assert.equal(p.z, -28)
  assert.ok(p.uncertainty > 0)
})

test('predictPosition membatasi kecepatan tidak wajar', () => {
  const warp = [{ t: 0, x: 0, y: 64, z: 0 }, { t: 50, x: 400, y: 64, z: 0 }]
  const p = predictPosition(warp, 1000, { maxSpeed: 12 })
  assert.ok(p.x - 400 <= 13, 'lompatan 400 blok tidak boleh diteruskan mentah')
  assert.equal(p.speed, 12)
})

test('predictPosition tanpa riwayat cukup mengembalikan posisi terakhir', () => {
  const p = predictPosition([samples[0]], 1000)
  assert.equal(p.x, 0)
  assert.equal(p.speed, 0)
})

test('formatCoords membulatkan ke 1 desimal', () => {
  assert.equal(formatCoords({ x: 12.34, y: 64, z: -5.678 }), '12.3 64.0 -5.7')
})
