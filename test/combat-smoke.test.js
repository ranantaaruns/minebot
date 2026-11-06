'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('events')
const Vec3 = require('vec3')
const { nextTick } = require('../src/combat/tick')

async function expect (bot, promise, name) {
  try {
    await promise
    console.log(`✓ ${name} (tidak crash)`)
  } catch (err) {
    console.error(`✗ ${name}: ${err.message}`)
    throw err
  }
}

test('smoke: lava attack tidak crash di bot tanpa inventory', async () => {
  const bot = new EventEmitter()
  bot.inventory = null
  const { LavaBucketAttack } = require('../src/combat/lava')
  const lava = new LavaBucketAttack(bot, null, { enabled: false })
  const res = await lava.tryAttack({ position: new Vec3(10, 64, 10) })
  assert.equal(res, false)
})
