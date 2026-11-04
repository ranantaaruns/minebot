'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const Vec3 = require('vec3')
const { fleeFrom, awayDirection, safeDirection, pathClear } = require('../src/safety/flee')

function blockNamed (name) {
  return { name, boundingBox: name === 'air' ? 'empty' : 'block' }
}

function fleeBot ({ position = new Vec3(0, 64, 0), food = 20, blockAt = null } = {}) {
  const bot = {
    entity: { position: position.clone(), yaw: 0 },
    food,
    controls: [],
    headings: [],
    steps: 0,
    direction: { x: -1, z: 0 },
    lookAt (point) {
      const dx = point.x - bot.entity.position.x
      const dz = point.z - bot.entity.position.z
      const length = Math.hypot(dx, dz) || 1
      bot.direction = { x: dx / length, z: dz / length }
      bot.headings.push(bot.direction)
    },
    setControlState (name, state) {
      bot.controls.push([name, state])
      if (name === 'forward' && state) {
        bot.steps++
        bot.entity.position = new Vec3(
          bot.entity.position.x + bot.direction.x * 0.25,
          bot.entity.position.y,
          bot.entity.position.z + bot.direction.z * 0.25
        )
      }
    },
    clearControlStates () { bot.controls.push(['clear', true]) },
    blockAt (pos) {
      if (blockAt) return blockAt(pos)
      return blockNamed('air')
    }
  }
  return bot
}

test('fleeFrom membawa bot menjauh dari target', async () => {
  const bot = fleeBot()
  const enemy = { position: new Vec3(2, 64, 0) }
  const result = await fleeFrom(bot, enemy, { tickMs: 1, durationMs: 400, distance: 3, zigzagMs: 20 })

  assert.ok(result.ticks >= 3)
  assert.ok(bot.entity.position.distanceTo(enemy.position) > 2)
  assert.equal(bot.controls.some(([name, state]) => name === 'forward' && state === true), true)
  assert.equal(bot.controls.at(-1)[0] === 'clear' || bot.controls.at(-1)[1] === false, true)
})

test('arah lari berbelok-belok, bukan garis lurus', async () => {
  const bot = fleeBot()
  const enemy = { position: new Vec3(2, 64, 0) }
  const straight = awayDirection(bot, enemy, 0)

  await fleeFrom(bot, enemy, { tickMs: 1, durationMs: 400, distance: 30, zigzagMs: 15, zigzagDeg: 40 })

  const sides = new Set()
  for (const heading of bot.headings) {
    const cross = straight.x * heading.z - straight.z * heading.x
    if (Math.abs(cross) > 0.05) sides.add(Math.sign(cross))
  }
  assert.deepEqual([...sides].sort(), [-1, 1], 'heading harus berganti sisi kiri/kanan')
})

test('fleeFrom berhenti saat stopWhen terpenuhi dan melepas kontrol', async () => {
  const bot = fleeBot({ position: new Vec3(-10, 64, 0) })
  const enemy = { position: new Vec3(-8, 64, 0) }
  let health = 6
  let ticks = 0

  const result = await fleeFrom(bot, enemy, {
    tickMs: 1,
    durationMs: 2000,
    distance: 8,
    zigzagMs: 5,
    stopWhen: () => health >= 16,
    onTick: () => { ticks++; health += 4 }
  })

  assert.equal(health >= 16, true)
  assert.ok(ticks >= 1)
  assert.ok(result.durationMs < 2000)
  assert.equal(bot.controls.at(-1)[0], 'clear')
})

test('fleeFrom tidak lari ke lava, mencari arah lain', async () => {
  const bot = fleeBot({
    blockAt: (pos) => (pos.x < -0.5 ? blockNamed('lava') : blockNamed('air'))
  })
  const enemy = { position: new Vec3(3, 64, 0) }

  const chosen = safeDirection(bot, enemy, 0)

  assert.equal(chosen.x > -0.5, true, 'arah yang dipilih tidak menembus lava')
  assert.equal(pathClear(bot, chosen), true)
})

test('fleeFrom memanggil onTick tiap putaran sambil tetap menggerakkan bot', async () => {
  const bot = fleeBot()
  const enemy = { position: new Vec3(2, 64, 0) }
  const seen = []

  await fleeFrom(bot, enemy, {
    tickMs: 1,
    durationMs: 400,
    distance: 40,
    zigzagMs: 10,
    onTick: ({ distance, ticks }) => seen.push({ distance, ticks })
  })

  assert.ok(seen.length >= 2)
  assert.ok(seen[0].distance < seen.at(-1).distance)
  assert.ok(bot.steps >= 2)
})

test('fleeFrom berhenti saat durasi habis walau target masih dekat', async () => {
  const bot = fleeBot({ blockAt: () => blockNamed('stone') })
  const enemy = { position: new Vec3(1, 64, 0) }

  const result = await fleeFrom(bot, enemy, { tickMs: 1, durationMs: 60, distance: 99, zigzagMs: 5 })

  assert.ok(result.durationMs >= 40)
  assert.equal(result.reachedSafe, false)
  assert.equal(bot.controls.at(-1)[0], 'clear')
})
