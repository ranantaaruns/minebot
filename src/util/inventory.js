'use strict'

function inventoryItems (bot) {
  if (!bot?.inventory) return []
  return bot.inventory.items()
}

function countItem (bot, itemId) {
  return inventoryItems(bot)
    .filter(item => item.type === itemId)
    .reduce((sum, item) => sum + item.count, 0)
}

function countItemName (bot, mcData, name) {
  const item = mcData.itemsByName[name]
  if (!item) return 0
  return countItem(bot, item.id)
}

function findItem (bot, itemId) {
  return inventoryItems(bot).find(item => item.type === itemId) || null
}

function findItemName (bot, mcData, name) {
  const item = mcData.itemsByName[name]
  if (!item) return null
  return findItem(bot, item.id)
}

function aggregateInventory (bot) {
  const map = new Map()
  for (const item of inventoryItems(bot)) {
    const current = map.get(item.name) || { name: item.name, type: item.type, count: 0 }
    current.count += item.count
    map.set(item.name, current)
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
}

function nameToId (mcData, name) {
  return mcData.itemsByName[name]?.id ?? null
}

function idToName (mcData, id) {
  return mcData.items[id]?.name ?? null
}

module.exports = {
  inventoryItems,
  countItem,
  countItemName,
  findItem,
  findItemName,
  aggregateInventory,
  nameToId,
  idToName
}
