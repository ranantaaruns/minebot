'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const Vec3 = require('vec3')
const {
  isNether,
  findNearbyPortal,
  isSafeFromLava,
  hasGoldArmor,
  findGoldArmorInInventory,
  StructureAvoidance,
  createLavaExclusion
} = require('../src/safety/nether')
const { CombatManager } = require('../src/safety/combat')
const { mineAncientDebris } = require('../src/materials/ancient-debris')

const silentLogger = {
  info () {},
  warn () {},
  debug () {},
  error () {}
}

test('isNether correctly identifies Nether dimension across formats', () => {
  assert.equal(isNether(null), false)
  assert.equal(isNether({}), false)
  assert.equal(isNether({ game: { dimension: 'minecraft:the_nether' } }), true)
  assert.equal(isNether({ game: { dimension: 'the_nether' } }), true)
  assert.equal(isNether({ game: { dimension: 'nether' } }), true)
  assert.equal(isNether({ game: { dimension: -1 } }), true)
  assert.equal(isNether({ game: { dimension: { name: 'minecraft:the_nether' } } }), true)
  assert.equal(isNether({ game: { dimension: { effects: 'the_nether' } } }), true)

  assert.equal(isNether({ game: { dimension: 'minecraft:overworld' } }), false)
  assert.equal(isNether({ game: { dimension: 0 } }), false)
  assert.equal(isNether({ game: { dimension: 1 } }), false)
  assert.equal(isNether({ game: { dimension: 'minecraft:the_end' } }), false)
})

test('findNearbyPortal finds nether_portal within specified radius', () => {
  const portalPos = new Vec3(10, 64, 12)
  const bot = {
    blockAt (p) {
      if (p.equals(portalPos)) {
        return { name: 'nether_portal' }
      }
      return { name: 'air' }
    }
  }

  // Found within radius 4 from (10, 64, 10)
  const found = findNearbyPortal(bot, new Vec3(10, 64, 10), 4)
  assert.ok(found)
  assert.equal(found.x, 10)
  assert.equal(found.y, 64)
  assert.equal(found.z, 12)

  // Not found when radius is too small
  const notFound = findNearbyPortal(bot, new Vec3(10, 64, 10), 1)
  assert.equal(notFound, null)
})

test('isSafeFromLava checks surrounding blocks and falling hazards', () => {
  const safeBlocks = new Map()
  const bot = {
    blockAt (p) {
      const key = `${p.x},${p.y},${p.z}`
      return safeBlocks.get(key) || { name: 'netherrack' }
    }
  }

  const center = new Vec3(5, 14, 5)
  assert.equal(isSafeFromLava(bot, center), true)

  // Place lava adjacent (east)
  safeBlocks.set('6,14,5', { name: 'lava' })
  assert.equal(isSafeFromLava(bot, center), false)

  // Clear east, place flowing lava 2 blocks above
  safeBlocks.delete('6,14,5')
  assert.equal(isSafeFromLava(bot, center), true)
  safeBlocks.set('5,16,5', { name: 'flowing_lava' })
  assert.equal(isSafeFromLava(bot, center), false)
})

test('hasGoldArmor and findGoldArmorInInventory detect gold pieces', () => {
  const botWithNoArmor = {
    inventory: {
      slots: [null, null, null, null, null, null, null, null, null],
      items: () => []
    }
  }
  assert.equal(hasGoldArmor(botWithNoArmor), false)
  assert.equal(findGoldArmorInInventory(botWithNoArmor), null)

  const botWithDiamondHelmet = {
    inventory: {
      slots: { 5: { name: 'diamond_helmet' } },
      items: () => [{ name: 'diamond_helmet' }, { name: 'golden_boots' }]
    }
  }
  assert.equal(hasGoldArmor(botWithDiamondHelmet), false)
  assert.deepEqual(findGoldArmorInInventory(botWithDiamondHelmet), { name: 'golden_boots' })

  const botWithGoldBootsEquipped = {
    inventory: {
      slots: { 8: { name: 'golden_boots' } },
      items: () => [{ name: 'golden_boots' }]
    }
  }
  assert.equal(hasGoldArmor(botWithGoldBootsEquipped), true)
})

test('StructureAvoidance detects Fortress and Bastion danger zones and excludes them', () => {
  const bot = {
    game: { dimension: 'minecraft:the_nether' },
    entity: { position: new Vec3(0, 60, 0) },
    entities: {
      1: { name: 'blaze', position: new Vec3(50, 65, 50) },
      2: { name: 'piglin_brute', position: new Vec3(-60, 70, -60) }
    }
  }

  const avoidance = new StructureAvoidance(bot, { avoidStructures: true, structureAvoidRadius: 48 }, silentLogger)
  avoidance.scan()

  assert.equal(avoidance.zones.length, 2)
  const fortressZone = avoidance.zones.find(z => z.type === 'fortress')
  const bastionZone = avoidance.zones.find(z => z.type === 'bastion')

  assert.ok(fortressZone)
  assert.ok(bastionZone)

  // Inside fortress zone
  assert.equal(avoidance.isInsideDangerZone(new Vec3(50, 65, 50)), true)
  assert.equal(avoidance.isInsideDangerZone(new Vec3(70, 65, 50)), true) // dist = 20 <= 48
  assert.equal(avoidance.isInsideDangerZone(new Vec3(120, 65, 50)), false) // dist = 70 > 48

  // Exclusion penalty
  const exclusion = avoidance.createStructureExclusion()
  assert.equal(exclusion({ position: new Vec3(52, 65, 50) }), 1000)
  assert.equal(exclusion({ position: new Vec3(0, 60, 0) }), 0)

  // Retreat vector points away from nearest danger
  bot.entity.position = new Vec3(40, 65, 50) // near blaze at 50, 65, 50
  const retreat = avoidance.getRetreatVector(bot)
  assert.ok(retreat.x < 0) // moving west away from x=50
})

test('CombatManager respects gold armor piglin pacification in Nether', () => {
  const botInNetherWithGold = {
    game: { dimension: 'minecraft:the_nether' },
    entity: { position: new Vec3(0, 60, 0) },
    inventory: {
      slots: { 8: { name: 'golden_boots' } }
    },
    entities: {
      1: { name: 'piglin', position: new Vec3(2, 60, 0) },
      2: { name: 'zombified_piglin', position: new Vec3(3, 60, 0) }
    }
  }

  const combatConfig = {
    enabled: true,
    detectRadius: 8,
    attackRange: 3.5
  }

  const combatWithGold = new CombatManager(botInNetherWithGold, combatConfig, silentLogger)
  assert.equal(combatWithGold.findTarget(), null)

  // If piglin brute appears, it attacks despite gold armor
  botInNetherWithGold.entities[3] = { name: 'piglin_brute', position: new Vec3(4, 60, 0) }
  const targetBrute = combatWithGold.findTarget()
  assert.ok(targetBrute)
  assert.equal(targetBrute.entity.name, 'piglin_brute')

  // If bot takes off gold armor in Nether, normal piglin becomes hostile
  const botWithoutGold = {
    game: { dimension: 'minecraft:the_nether' },
    entity: { position: new Vec3(0, 60, 0) },
    inventory: { slots: {} },
    entities: {
      1: { name: 'piglin', position: new Vec3(2, 60, 0) }
    }
  }
  const combatNoGold = new CombatManager(botWithoutGold, combatConfig, silentLogger)
  const targetPiglin = combatNoGold.findTarget()
  assert.ok(targetPiglin)
  assert.equal(targetPiglin.entity.name, 'piglin')
})

test('mineAncientDebris validates Nether dimension', async () => {
  const botOverworld = {
    game: { dimension: 'minecraft:overworld' },
    inventory: { items: () => [] }
  }
  const mcData = {
    itemsByName: { ancient_debris: { id: 100 } },
    blocksByName: { ancient_debris: { id: 100 } }
  }

  const res = await mineAncientDebris(botOverworld, mcData, null, 2, { logger: silentLogger })
  assert.equal(res.ok, false)
  assert.equal(res.reason, 'dimension-not-nether')
})

test('mineAncientDebris requires Diamond or Netherite pickaxe', async () => {
  const botNetherIronPick = {
    game: { dimension: 'minecraft:the_nether' },
    inventory: {
      items: () => [{ name: 'iron_pickaxe', count: 1 }]
    }
  }
  const mcData = {
    itemsByName: {
      ancient_debris: { id: 100 },
      iron_pickaxe: { id: 200 },
      diamond_pickaxe: { id: 201 },
      netherite_pickaxe: { id: 202 }
    },
    blocksByName: { ancient_debris: { id: 100 } }
  }

  const res = await mineAncientDebris(botNetherIronPick, mcData, null, 1, { logger: silentLogger })
  assert.equal(res.ok, false)
  assert.equal(res.reason, 'no-diamond-pickaxe')
})

test('createLavaExclusion applies penalty for lava and adjacent blocks', () => {
  const blocks = new Map()
  const bot = {
    blockAt (p) {
      return blocks.get(`${p.x},${p.y},${p.z}`) || { name: 'air' }
    }
  }
  const exclusion = createLavaExclusion(bot)

  // Direct lava block
  blocks.set('10,14,10', { name: 'lava' })
  assert.equal(exclusion({ position: new Vec3(10, 14, 10) }), 1000)

  // Direct fire block
  blocks.set('10,14,11', { name: 'fire' })
  assert.equal(exclusion({ position: new Vec3(10, 14, 11) }), 1000)

  // Adjacent block to lava (10, 14, 9)
  assert.equal(exclusion({ position: new Vec3(10, 14, 9) }), 500)

  // Safe air block
  assert.equal(exclusion({ position: new Vec3(20, 14, 20) }), 0)
})

test('OwnerTracker triggers followThroughPortal when owner steps near portal', async t => {
  const { EventEmitter } = require('events')
  const { OwnerTracker } = require('../src/owner')

  const bot = new EventEmitter()
  bot.entity = { position: new Vec3(0, 64, 0), onGround: true }
  bot.players = {
    Owner: {
      entity: { position: new Vec3(5, 64, 0) }
    }
  }
  bot.entities = {}
  bot.pathfinder = {
    goal: null,
    setGoal () {},
    stop () {},
    async goto () {}
  }
  bot.blockAt = p => {
    if (p.x === 5 && p.y === 64 && p.z === 0) {
      return { name: 'nether_portal' }
    }
    return { name: 'air' }
  }

  const tracker = new OwnerTracker(bot, { username: 'Owner', autoFollow: true, portalFollow: true }, silentLogger)
  t.after(() => tracker.stop())

  let followedPortal = null
  tracker.followThroughPortal = async portalPos => {
    followedPortal = portalPos
    return true
  }

  await tracker.tick()
  assert.ok(followedPortal)
  assert.equal(followedPortal.x, 5)
  assert.equal(followedPortal.y, 64)
  assert.equal(followedPortal.z, 0)
})

test('OwnerTracker retreats when inside Nether danger zone', async t => {
  const { EventEmitter } = require('events')
  const { OwnerTracker } = require('../src/owner')

  const bot = new EventEmitter()
  bot.game = { dimension: 'minecraft:the_nether' }
  bot.entity = { position: new Vec3(10, 64, 10), onGround: true }
  bot.players = { Owner: { entity: { position: new Vec3(10, 64, 10) } } }
  bot.entities = {}
  bot.pathfinder = {
    goal: null,
    setGoal () {},
    stop () {},
    async goto () {}
  }
  bot.blockAt = () => ({ name: 'netherrack' })

  const avoidance = new StructureAvoidance(bot, { avoidStructures: true, structureAvoidRadius: 48 }, silentLogger)
  avoidance.zones.push({
    type: 'fortress',
    center: new Vec3(15, 64, 10),
    radius: 48,
    expiresAt: Date.now() + 60000
  })

  const tracker = new OwnerTracker(bot, { username: 'Owner', autoFollow: true, avoidStructures: true }, silentLogger, { structureAvoidance: avoidance })
  t.after(() => tracker.stop())

  let retreatedFrom = null
  tracker._retreatFromDanger = async zone => {
    retreatedFrom = zone
  }

  await tracker.tick()
  assert.ok(retreatedFrom)
  assert.equal(retreatedFrom.type, 'fortress')
})

