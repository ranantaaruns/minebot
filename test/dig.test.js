'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const Vec3 = require('vec3')
const { mineBlock, inReach } = require('../src/materials/dig')

const silentLogger = { info () {}, warn () {}, debug () {}, error () {} }

function digBot ({ position = new Vec3(0, 64, 0), digFails = false, gotoFails = false, gotoTeleport = null } = {}) {
  const bot = {
    entity: { position, height: 1.8 },
    digs: [],
    equipped: [],
    pathfinder: {
      gotoCalls: 0,
      stop () {},
      async goto (goal) {
        this.gotoCalls++
        this.goal = goal
        if (gotoFails) throw new Error('No path to the goal!')
        if (gotoTeleport) bot.entity.position = gotoTeleport
      }
    },
    tool: {
      async equipForBlock (block) { bot.equipped.push(block.name) }
    },
    async dig (block) {
      bot.digs.push(block)
      if (digFails) throw new Error('Digging timed out')
    }
  }
  return bot
}

const ORE = { name: 'coal_ore', position: new Vec3(1, 64, 0) }
const FAR_ORE = { name: 'coal_ore', position: new Vec3(12, 64, 0) }

test('blok dalam jangkauan langsung dihancurkan tanpa berjalan', async () => {
  const bot = digBot()

  const result = await mineBlock(bot, ORE, { logger: silentLogger })

  assert.equal(result.ok, true)
  assert.equal(bot.pathfinder.gotoCalls, 0, 'tidak perlu pathfinding untuk blok di samping bot')
  assert.deepEqual(bot.equipped, ['coal_ore'], 'tool dipilih sesuai blok')
  assert.equal(bot.digs.length, 1)
})

test('blok jauh: bot berjalan sekali lalu menggali', async () => {
  const bot = digBot({ gotoTeleport: new Vec3(10, 64, 0) })

  const result = await mineBlock(bot, FAR_ORE, { logger: silentLogger })

  assert.equal(result.ok, true)
  assert.equal(bot.pathfinder.gotoCalls, 1)
  assert.equal(bot.digs.length, 1)
})

test('blok jauh yang tidak terjangkau dilaporkan unreachable tanpa menggali', async () => {
  const bot = digBot({ gotoFails: true })

  const result = await mineBlock(bot, FAR_ORE, { logger: silentLogger })

  assert.equal(result.ok, false)
  assert.equal(result.reason, 'unreachable')
  assert.equal(bot.digs.length, 0)
})

test('gagal menggali langsung dicoba lagi setelah berjalan', async () => {
  const bot = digBot({ gotoTeleport: new Vec3(2, 64, 0) })
  let attempts = 0
  bot.dig = async block => {
    attempts++
    bot.digs.push(block)
    if (attempts === 1) throw new Error('Digging timed out')
  }

  const result = await mineBlock(bot, ORE, { logger: silentLogger })

  assert.equal(result.ok, true)
  assert.equal(attempts, 2)
})

test('inReach memakai posisi mata bot', () => {
  const bot = digBot({ position: new Vec3(0, 64, 0) })
  assert.equal(inReach(bot, { position: new Vec3(0, 64, 3) }), true)
  assert.equal(inReach(bot, { position: new Vec3(0, 74, 0) }), false)
})
