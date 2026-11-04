'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const Vec3 = require('vec3')
const { jumpCrit, canCrit } = require('../src/safety/crit')

// Bot dengan physics sederhana: melompat saat kontrol jump aktif, lalu jatuh
// karena gravitasi sampai menyentuh tanah lagi.
function critBot ({
  onGround = true,
  inWater = false,
  sprinting = false,
  feet = 'air',
  jumpable = true
} = {}) {
  const bot = {
    entity: {
      position: new Vec3(0, 64, 0),
      velocity: new Vec3(0, 0, 0),
      onGround,
      isInWater: inWater
    },
    controlState: { sprint: sprinting },
    attacks: [],
    jumps: 0,
    setControlState (name, state) {
      bot.controlState[name] = state
      if (name === 'jump' && state && jumpable && bot.entity.onGround) {
        bot.jumps++
        bot.entity.velocity = new Vec3(0, 0.42, 0)
        bot.entity.onGround = false
      }
    },
    blockAt: () => ({ name: feet, boundingBox: feet === 'air' ? 'empty' : 'block' }),
    attack (entity) {
      bot.attacks.push({
        id: entity?.id,
        velocityY: bot.entity.velocity.y,
        onGround: bot.entity.onGround
      })
    }
  }

  const gravity = setInterval(() => {
    if (bot.entity.onGround) return
    const vy = bot.entity.velocity.y - 0.08
    bot.entity.velocity = new Vec3(0, vy, 0)
    const y = bot.entity.position.y + vy
    if (y <= 64) {
      bot.entity.position = new Vec3(bot.entity.position.x, 64, bot.entity.position.z)
      bot.entity.velocity = new Vec3(0, 0, 0)
      bot.entity.onGround = true
    } else {
      bot.entity.position = new Vec3(bot.entity.position.x, y, bot.entity.position.z)
    }
  }, 4)
  gravity.unref?.()

  bot.stopPhysics = () => clearInterval(gravity)
  return bot
}

const enemy = (x = 2) => ({ id: 9, position: new Vec3(x, 64, 0), height: 1.8 })

test('canCrit hanya saat berdiri di tanah dan tidak di air/tangga', () => {
  assert.equal(canCrit(critBot()), true)
  assert.equal(canCrit(critBot({ inWater: true })), false)
  assert.equal(canCrit(critBot({ sprinting: true })), false)
  assert.equal(canCrit(critBot({ onGround: false })), false)
  assert.equal(canCrit(critBot({ feet: 'ladder' })), false)
  assert.equal(canCrit({ entity: { position: new Vec3(0, 64, 0) } }), false, 'tanpa velocity bukan bot nyata')
})

test('jumpCrit melompat lalu memukul saat sedang jatuh (damage kritikal)', async () => {
  const bot = critBot()
  const target = enemy()

  const result = await jumpCrit(bot, target, { tickMs: 3 })

  assert.equal(result.attacked, true)
  assert.equal(result.crit, true)
  assert.equal(bot.jumps, 1)
  assert.equal(bot.attacks.length, 1)
  assert.ok(bot.attacks[0].velocityY < 0, 'pukulan mendarat saat velocity.y negatif')
  assert.equal(bot.attacks[0].onGround, false, 'pukulan mendarat saat di udara')
  assert.equal(bot.controlState.jump, false, 'kontrol lompat dilepas setelah memukul')
  bot.stopPhysics()
})

test('jumpCrit tidak menyerang kalau bot tidak bisa melompat', async () => {
  const bot = critBot({ jumpable: false })
  const result = await jumpCrit(bot, enemy(), { tickMs: 3, riseTimeoutMs: 40 })

  assert.equal(result.attacked, false)
  assert.equal(result.reason, 'no-jump')
  assert.equal(bot.attacks.length, 0)
  bot.stopPhysics()
})

test('jumpCrit tidak menyerang kalau target kabur dari jangkauan', async () => {
  const bot = critBot()
  const target = enemy(2)

  const run = jumpCrit(bot, target, { tickMs: 3, maxRange: 3 })
  target.position = new Vec3(9, 64, 0)
  const result = await run

  assert.equal(result.attacked, false)
  assert.equal(result.reason, 'out-of-reach')
  assert.equal(bot.attacks.length, 0)
  bot.stopPhysics()
})

test('jumpCrit tidak menyerang saat sprint (crit tidak berlaku)', async () => {
  const bot = critBot({ sprinting: true })
  bot.setControlState = function (name, state) {
    bot.controlState[name] = state
    if (name === 'jump' && state) {
      bot.entity.velocity = new Vec3(0, 0.42, 0)
      bot.entity.onGround = false
    }
  }

  const result = await jumpCrit(bot, enemy(), { tickMs: 3 })

  assert.equal(bot.controlState.sprint, false, 'sprint dimatikan dulu supaya crit sah')
  assert.equal(result.crit, true)
  bot.stopPhysics()
})
