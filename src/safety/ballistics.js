'use strict'

const Vec3 = require('vec3')

// Fisika panah Minecraft (Java), per tick:
//   pos += velocity
//   velocity *= drag
//   velocity.y -= gravity
// Kecepatan awal busur dengan tarikan penuh = 3 blok/tick.
const GRAVITY = 0.05
const DRAG = 0.99
const MAX_SPEED = 3
const TICKS_PER_SECOND = 20

// Titik keluar panah: mata bot, bukan kakinya. Salah di sini membuat bidikan
// meleset ke atas beberapa blok pada jarak jauh.
// Harus sama persis dengan titik acuan `bot.lookAt` di mineflayer
// (position + height * 0.9). Kalau berbeda, sudut yang kita hitung tidak sama
// dengan sudut yang benar-benar dikirim bot ke server.
function eyePosition (bot) {
  const position = bot?.entity?.position
  if (!position) return null
  const height = Number(bot.entity.height) || 1.8
  return position.offset(0, height * 0.9, 0)
}

// Simulasi diskrit persis seperti server: berapa tinggi panah saat sudah
// menempuh `distance` blok horizontal.
function flightToDistance ({
  horizontalSpeed,
  verticalSpeed,
  distance,
  drag = DRAG,
  gravity = GRAVITY,
  maxTicks = 400
}) {
  let x = 0
  let y = 0
  let vx = horizontalSpeed
  let vy = verticalSpeed
  const wanted = Number(distance) || 0
  if (wanted <= 0) return { y: 0, ticks: 0, reachable: true }

  for (let tick = 0; tick < maxTicks; tick++) {
    const nextX = x + vx
    const nextY = y + vy
    if (nextX >= wanted) {
      const ratio = vx > 0 ? (wanted - x) / vx : 1
      return { y: y + vy * ratio, ticks: tick + Math.max(0, ratio), reachable: true }
    }
    x = nextX
    y = nextY
    vx *= drag
    vy = vy * drag - gravity
    if (vy < 0 && y < wanted * -10) break
  }
  return { y, ticks: maxTicks, reachable: false }
}

// Titik yang bisa dipakai `bot.lookAt` untuk menghasilkan sudut `pitch`.
// Penting: titik ini harus berada di GARIS ARAH tembakan, bukan di titik jatuh
// panah — arah ke titik jatuh adalah garis potong (secant), bukan garis singgung
// lintasan, sehingga membidik titik jatuh selalu membuat panah meleset ke bawah.
function aimPointFromDirection (from, dx, dz, distance, pitch, aimDistance) {
  const flat = Math.cos(pitch)
  const length = distance > 0.0001 ? distance : 1
  const dir = new Vec3((dx / length) * flat, Math.sin(pitch), (dz / length) * flat)
  if (dir.norm() < 0.0001) return new Vec3(from.x, from.y + Math.sin(pitch) * aimDistance, from.z)
  return from.plus(dir.normalize().scale(Math.max(2, aimDistance)))
}

// Cari sudut tembak yang membuat panah melewati `to` (biasanya bagian tengah
// badan lawan). Sudut dicari dari yang paling datar, jadi bot memilih lintasan
// rendah yang cepat sampai — bukan melengkung tinggi ke udara.
function solveArrow ({ from, to, speed = MAX_SPEED, drag = DRAG, gravity = GRAVITY, maxTicks = 400 }) {
  if (!from || !to) return null
  const dx = to.x - from.x
  const dz = to.z - from.z
  const distance = Math.hypot(dx, dz)
  const height = to.y - from.y
  const launchSpeed = Math.max(0.1, Number(speed) || MAX_SPEED)

  if (distance < 0.05) {
    // Lawan hampir menempel: tembak lurus ke arahnya.
    return {
      point: new Vec3(to.x, to.y, to.z),
      impact: new Vec3(to.x, to.y, to.z),
      pitch: Math.atan2(height, 0.05) - Math.PI / 2,
      yaw: Math.atan2(-dx, -dz),
      ticks: 0,
      distance,
      reachable: true
    }
  }

  const evaluate = pitch => flightToDistance({
    horizontalSpeed: Math.max(0, Math.cos(pitch)) * launchSpeed,
    verticalSpeed: Math.sin(pitch) * launchSpeed,
    distance,
    drag,
    gravity,
    maxTicks
  })

  let low = null
  let high = null
  for (let degrees = -70; degrees <= 70; degrees++) {
    const pitch = degrees * Math.PI / 180
    const flight = evaluate(pitch)
    if (!flight.reachable) {
      // Panah jatuh sebelum sampai: sudut lebih tegak tidak akan menolong.
      low = null
      continue
    }
    if (flight.y >= height) {
      high = { pitch, y: flight.y }
      break
    }
    low = { pitch, y: flight.y }
  }

  if (!high) {
    return {
      point: to.clone ? to.clone() : new Vec3(to.x, to.y, to.z),
      impact: null,
      pitch: null,
      yaw: Math.atan2(-dx, -dz),
      ticks: null,
      distance,
      reachable: false
    }
  }

  // Kalau sudut paling datar sudah melewati target, sempitkan batas bawahnya.
  if (!low) low = { pitch: high.pitch - Math.PI / 180, y: null }
  let a = low.pitch
  let b = high.pitch
  for (let i = 0; i < 40; i++) {
    const mid = (a + b) / 2
    const flight = evaluate(mid)
    if (!flight.reachable || flight.y < height) a = mid
    else b = mid
  }

  const pitch = (a + b) / 2
  const flight = evaluate(pitch)
  return {
    point: aimPointFromDirection(from, dx, dz, distance, pitch, distance),
    impact: new Vec3(to.x, from.y + flight.y, to.z),
    pitch,
    yaw: Math.atan2(-dx, -dz),
    ticks: flight.ticks,
    distance,
    reachable: true
  }
}

// Titik bidik untuk `bot.lookAt`: titik di lintasan panah tepat di atas/di depan
// posisi lawan yang diperkirakan saat panah tiba.
function predictAimPoint (bot, entity, options = {}) {
  const {
    speed = MAX_SPEED,
    leadIterations = 2,
    maxLeadTicks = 30,
    heightRatio = 0.5
  } = options

  const from = eyePosition(bot)
  const position = entity?.position
  if (!from || !position) return null

  const size = Number(entity.height) || 1.8
  const base = position.offset(0, size * heightRatio, 0)
  const velocity = entity.velocity || { x: 0, y: 0, z: 0 }

  let target = base
  let solution = solveArrow({ from, to: target, speed })

  // Lawan yang bergerak: perkirakan posisinya saat panah tiba, ulangi sekali
  // lagi karena perubahan jarak juga mengubah waktu tempuh.
  for (let i = 0; i < leadIterations; i++) {
    if (!solution?.reachable) break
    const ticks = Math.min(maxLeadTicks, Number(solution.ticks) || 0)
    const lead = new Vec3(
      (Number(velocity.x) || 0) * ticks,
      (Number(velocity.y) || 0) * ticks,
      (Number(velocity.z) || 0) * ticks
    )
    if (lead.norm() < 0.05) break
    target = base.plus(lead)
    solution = solveArrow({ from, to: target, speed })
  }

  return solution?.point || target
}

module.exports = {
  GRAVITY,
  DRAG,
  MAX_SPEED,
  TICKS_PER_SECOND,
  eyePosition,
  flightToDistance,
  solveArrow,
  predictAimPoint
}
