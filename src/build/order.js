'use strict'

function orderActions (actions, startPos) {
  const byLayer = new Map()
  for (const action of actions) {
    const y = action.pos.y
    if (!byLayer.has(y)) byLayer.set(y, [])
    byLayer.get(y).push(action)
  }

  const layers = [...byLayer.keys()].sort((a, b) => a - b)
  const ordered = []

  for (const y of layers) {
    const layer = byLayer.get(y)
    const zValues = [...new Set(layer.map(action => action.pos.z))].sort((a, b) => a - b)
    const zForward = startPos ? Math.abs((zValues[0] ?? 0) - startPos.z) <= Math.abs((zValues[zValues.length - 1] ?? 0) - startPos.z) : true

    const zOrder = zForward ? zValues : [...zValues].reverse()
    for (const z of zOrder) {
      const row = layer
        .filter(action => action.pos.z === z)
        .sort((a, b) => a.pos.x - b.pos.x)
      if (!zForward) row.reverse()
      ordered.push(...row)
    }
  }

  return ordered
}

function groupByLayer (actions) {
  const map = new Map()
  for (const action of actions) {
    const y = action.pos.y
    if (!map.has(y)) map.set(y, [])
    map.get(y).push(action)
  }
  return map
}

module.exports = { orderActions, groupByLayer }
