'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const Vec3 = require('vec3')
const {
  flightToDistance,
  solveArrow,
  predictAimPoint,
  eyePosition,
  MAX_SPEED
} = require('../src/safety/ballistics')

// Simulasi independen dari modul (tidak memakai flightToDistance): panah
// meluncur ke arah `point`, lalu tiap tick pos += v; v *= 0.99; v.y -= 0.05.
// Hasilnya selisih tinggi panah dengan pusat badan lawan saat jarak horizontal
// sudah sama.
function landOffset (from, point, target, speed = MAX_SPEED) {
  const dir = point.minus(from).normalize()
  let position = from.clone()
  let velocity = dir.scale(speed)
  const flat = Math.hypot(target.x - from.x, target.z - from.z)
  let travelled = 0
  for (let tick = 0; tick < 400; tick++) {
    const step = Math.hypot(velocity.x, velocity.z)
    if (travelled + step >= flat) {
      const ratio = step > 0 ? (flat - travelled) / step : 1
      return position.y + velocity.y * ratio - target.y
    }
    position = position.plus(velocity)
    travelled += step
    velocity = new Vec3(velocity.x * 0.99, velocity.y * 0.99 - 0.05, velocity.z * 0.99)
  }
  return NaN
}

function hunterBot (position = new Vec3(0, 64, 0)) {
  return { entity: { position, height: 1.8 } }
}

test('eyePosition memakai tinggi mata, bukan kaki', () => {
  const eye = eyePosition(hunterBot(new Vec3(3, 64, 5)))
  assert.equal(eye.x, 3)
  assert.equal(eye.z, 5)
  assert.ok(Math.abs(eye.y - (64 + 1.62)) < 1e-6)
  assert.equal(eyePosition({}), null)
})

test('flightToDistance mengikuti drag dan gravitasi per tick', () => {
  // Lurus mendatar: setelah 1 tick panah turun 0.05, lalu makin cepat jatuh.
  const first = flightToDistance({ horizontalSpeed: 3, verticalSpeed: 0, distance: 3 })
  assert.ok(Math.abs(first.y - 0) < 1e-9)
  const ten = flightToDistance({ horizontalSpeed: 3, verticalSpeed: 0, distance: 30 })
  assert.ok(ten.y < -1 && ten.y > -3.5, `jatuh wajar, dapat ${ten.y}`)
  assert.equal(flightToDistance({ horizontalSpeed: 3, verticalSpeed: 0, distance: 0 }).y, 0)
})

test('bidikan busur penuh mendarat di badan lawan pada semua jarak dan ketinggian', () => {
  const from = new Vec3(0, 66.62, 0)
  for (const distance of [3, 8, 16, 24, 32, 40]) {
    for (const height of [-6, -1, 0, 2, 8]) {
      const target = new Vec3(distance, 66.62 + height, 0)
      const solution = solveArrow({ from, to: target })
      assert.equal(solution.reachable, true, `jarak ${distance} harus terjangkau`)
      const offset = landOffset(from, solution.point, target)
      assert.ok(Math.abs(offset) < 0.02,
        `jarak ${distance}, beda tinggi ${height}: meleset ${offset.toFixed(3)} blok`)
    }
  }
})

// Heuristik lama: bidik di atas lawan sejauh 0.5*g*t^2 dengan t = jarak 3D / 3
// dan titik bidik 0.8 * tinggi badan di atas kaki.
function legacyAim (entity, distance) {
  const ticks = distance / MAX_SPEED
  const drop = 0.5 * 0.05 * ticks * ticks
  return new Vec3(
    entity.position.x + (entity.velocity?.x || 0) * ticks,
    entity.position.y + entity.height * 0.8 + (entity.velocity?.y || 0) * ticks + drop,
    entity.position.z + (entity.velocity?.z || 0) * ticks
  )
}

test('prediksi lintasan jauh lebih akurat daripada heuristik drop sederhana', () => {
  const from = new Vec3(0, 65.62, 0)
  for (const [name, position] of [
    ['mendatar 24', new Vec3(24, 64, 0)],
    ['lawan di atas +8', new Vec3(24, 72, 0)],
    ['lawan di bawah -8', new Vec3(24, 56, 0)],
    ['jauh 40', new Vec3(40, 64, 0)]
  ]) {
    const entity = { position, velocity: new Vec3(0, 0, 0), height: 1.8 }
    const center = position.offset(0, 0.9, 0)
    const distance3d = Math.hypot(position.x, position.y - 64, position.z)

    const ours = Math.abs(landOffset(from, solveArrow({ from, to: center }).point, center))
    const legacy = Math.abs(landOffset(from, legacyAim(entity, distance3d), center))

    assert.ok(ours < 0.02, `${name}: prediksi baru harus tepat, dapat ${ours.toFixed(3)}`)
    assert.ok(legacy > 0.3, `${name}: heuristik lama memang meleset, dapat ${legacy.toFixed(3)}`)
  }
})

test('bidikan mengikuti arah: naik untuk lawan di atas, turun untuk lawan di bawah', () => {
  const from = new Vec3(0, 66.62, 0)
  const up = solveArrow({ from, to: new Vec3(20, 74, 0) })
  const flat = solveArrow({ from, to: new Vec3(20, 66.62, 0) })
  const down = solveArrow({ from, to: new Vec3(20, 58, 0) })

  assert.ok(up.pitch > flat.pitch)
  assert.ok(down.pitch < flat.pitch)
  assert.ok(flat.pitch > 0, 'bahkan mendatar butuh sudut naik karena panah jatuh')
})

test('target bergerak diarahkan di depan sesuai waktu tempuh panah', () => {
  const bot = hunterBot()
  const entity = {
    position: new Vec3(20, 64, 0),
    velocity: new Vec3(0.2, 0, 0),
    height: 1.8
  }
  const point = predictAimPoint(bot, entity)
  const stationary = predictAimPoint(bot, { ...entity, velocity: new Vec3(0, 0, 0) })

  assert.ok(point.x > stationary.x, 'harus membidik di depan target yang menjauh')
  assert.ok(point.x - stationary.x > 0.5 && point.x - stationary.x < 4, 'lead wajar')
  // Lawan yang menjauh juga butuh sedikit kompensasi jatuh lebih besar.
  assert.ok(point.y > stationary.y)
})

test('lawan yang mendekat dibidik lebih dekat, bukan di belakang', () => {
  const bot = hunterBot()
  const entity = { position: new Vec3(20, 64, 0), velocity: new Vec3(-0.3, 0, 0), height: 1.8 }
  const point = predictAimPoint(bot, entity)
  assert.ok(point.x < 20)
  assert.ok(point.x > 16)
})

test('target di luar jangkauan panah ditandai tidak terjangkau', () => {
  const solution = solveArrow({ from: new Vec3(0, 66.62, 0), to: new Vec3(200, 66.62, 0) })
  assert.equal(solution.reachable, false)
  assert.equal(solution.pitch, null)
})

test('panah dari tarikan kurang (kecepatan lebih rendah) tetap diarahkan benar', () => {
  const from = new Vec3(0, 66.62, 0)
  const target = new Vec3(18, 66.62, 0)
  const slow = solveArrow({ from, to: target, speed: 2.4 })
  const offset = landOffset(from, slow.point, target, 2.4)
  assert.ok(Math.abs(offset) < 0.02)
  const full = solveArrow({ from, to: target })
  assert.ok(slow.pitch > full.pitch, 'panah pelan harus ditembak lebih ke atas')
})
