'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { HotbarLoadout, TAGS, ITEM_RULES, resolveCapabilities, bareName, pickItem } = require('../src/combat/loadout')

function item (name, count = 1) { return { name, count, type: 1 } }

function fakeBot (inventoryItems) {
  const slots = new Array(46).fill(null)
  // taruh semua item di inventory utama (slot 9..35) supaya arrange harus memindahkan
  inventoryItems.forEach((it, i) => { slots[9 + i] = it })
  const bot = {
    inventory: {
      slots,
      items: () => slots.filter(Boolean)
    },
    moves: [],
    moveSlotItem: async (from, to) => {
      bot.moves.push([from, to])
      const tmp = slots[to]
      slots[to] = slots[from]
      slots[from] = tmp
    },
    equipCalls: [],
    equip: async (it, dest) => { bot.equipCalls.push([it.name, dest]); slots[6] = it },
    quickBar: null,
    setQuickBarSlot: (i) => { bot.quickBar = i }
  }
  return bot
}

const FULL = [
  item('mace'), item('diamond_sword'), item('wind_charge', 8),
  item('firework_rocket', 16), item('netherite_axe'), item('water_bucket'),
  item('golden_apple', 4), item('elytra'), item('netherite_chestplate')
]

test('bareName membersihkan prefix minecraft:', () => {
  assert.equal(bareName({ name: 'minecraft:mace' }), 'mace')
  assert.equal(bareName(undefined), '')
})

test('pickItem menghormati prioritas nama', () => {
  const items = [item('diamond_sword'), item('netherite_spear')]
  assert.equal(pickItem(items, ['netherite_spear', 'diamond_sword']).name, 'netherite_spear')
  assert.equal(pickItem([item('diamond_sword')], ['netherite_spear', 'diamond_sword']).name, 'diamond_sword')
  assert.equal(pickItem([], ['mace']), null)
})

test('resolveCapabilities membuang item yang tidak ada di versi ini', () => {
  const mcData = require('minecraft-data')('1.21.4')
  const caps = resolveCapabilities(mcData, ITEM_RULES)
  assert.ok(caps.mace.includes('mace'))
  assert.ok(!caps.spear.includes('netherite_spear'), 'spear tidak ada di 1.21.4')
  assert.ok(caps.spear.includes('netherite_sword'))
})

test('arrange memindahkan item ke slot hotbar 0..6', async () => {
  const bot = fakeBot(FULL)
  const loadout = new HotbarLoadout(bot, {})
  await loadout.arrange()
  const names = [0, 1, 2, 3, 4, 5, 6].map(i => bareName(bot.inventory.slots[36 + i]))
  assert.deepEqual(names, [
    'mace', 'diamond_sword', 'wind_charge',
    'firework_rocket', 'netherite_axe', 'water_bucket', 'golden_apple'
  ])
})

test('select memakai setQuickBarSlot setelah arrange', async () => {
  const bot = fakeBot(FULL)
  const loadout = new HotbarLoadout(bot, {})
  await loadout.arrange()
  assert.equal(await loadout.select(TAGS.WIND_CHARGE), true)
  assert.equal(bot.quickBar, 2)
})

test('select gagal bila item tidak ada (tanpa melempar)', async () => {
  const bot = fakeBot([item('mace')])
  const loadout = new HotbarLoadout(bot, {})
  assert.equal(await loadout.select(TAGS.WATER), false)
})

test('count menghitung amunisi', () => {
  const bot = fakeBot(FULL)
  const loadout = new HotbarLoadout(bot, {})
  assert.equal(loadout.count(TAGS.WIND_CHARGE), 8)
  assert.equal(loadout.count(TAGS.FIREWORK), 16)
  assert.equal(loadout.count(TAGS.MACE), 1)
})

test('swapChest memasang elytra lalu chestplate', async () => {
  const bot = fakeBot(FULL)
  const loadout = new HotbarLoadout(bot, {})
  assert.equal(await loadout.swapChest(TAGS.ELYTRA), true)
  assert.deepEqual(bot.equipCalls[0], ['elytra', 'torso'])
  assert.equal(loadout.wearingElytra, true)
  assert.equal(await loadout.swapChest(TAGS.CHESTPLATE), true)
  assert.deepEqual(bot.equipCalls[1], ['netherite_chestplate', 'torso'])
  assert.equal(loadout.wearingElytra, false)
})

test('swapChest tidak memanggil equip bila sudah terpasang', async () => {
  const bot = fakeBot(FULL)
  const loadout = new HotbarLoadout(bot, {})
  await loadout.swapChest(TAGS.ELYTRA)
  await loadout.swapChest(TAGS.ELYTRA)
  assert.equal(bot.equipCalls.length, 1)
})
