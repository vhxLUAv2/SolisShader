'use strict'

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { setTimeout: delay } = require('node:timers/promises')
const mineflayer = require('@wp2508/mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const Vec3 = require('vec3').Vec3
const prismarineItem = require('prismarine-item')

const MAX_BLOCKS = Number.parseInt(process.env.BUILD_MAX_BLOCKS || '50000', 10)
const MAX_ATTEMPTS_PER_BLOCK = Number.parseInt(process.env.BUILD_BLOCK_ATTEMPTS || '3', 10)
const BUILD_DELAY_MS = Number.parseInt(process.env.BUILD_DELAY_MS || '250', 10)
const BUILD_MAX_PASSES = Number.parseInt(process.env.BUILD_MAX_PASSES || '4', 10)
const STATE_FILE = path.resolve(process.env.BUILD_STATE_FILE || './build-state.json')
let activeSchematicHash = null
const SCHEMATIC_FILE = process.argv[2]
const ORIGIN = process.argv.slice(3, 6).map(Number)

function fail(message) {
  console.error(message)
  process.exitCode = 1
}

function blockName(name) {
  const plain = String(name || '').split('[')[0].split('{')[0]
  return plain && !plain.includes(':') ? 'minecraft:' + plain : plain
}

function isAir(name) {
  return ['minecraft:air', 'minecraft:cave_air', 'minecraft:void_air'].includes(blockName(name))
}

async function loadSchematic(file) {
  const { Schematic } = await import('nucleation')
  const bytes = fs.readFileSync(file)
  let schematic
  try {
    schematic = Schematic.fromData(Array.from(bytes))
  } catch (error) {
    throw new Error('Could not parse .schem/.litematic data: ' + error.message)
  }

  // Nucleation's JS API exposes structured block states through blocks().
  // Keep properties such as facing, axis, half, shape, rotation, and waterlogged.
  let sourceBlocks
  if (typeof schematic.blocks === 'function') {
    sourceBlocks = schematic.blocks()
  } else if (typeof schematic.getNonAirBlocksJson === 'function') {
    sourceBlocks = JSON.parse(schematic.getNonAirBlocksJson())
  } else {
    throw new Error('This Nucleation version does not expose a supported block-list API.')
  }
  if (!Array.isArray(sourceBlocks)) throw new Error('The schematic parser returned an invalid block list.')

  const blocks = sourceBlocks.filter(block => !isAir(block.name)).map((block, index) => {
    const x = Number(block.x)
    const y = Number(block.y)
    const z = Number(block.z)
    const name = blockName(block.name)
    if (![x, y, z].every(Number.isSafeInteger) || !name) {
      throw new Error(`Invalid block entry at index ${index}.`)
    }
    const properties = block.properties && typeof block.properties === 'object'
      ? Object.fromEntries(Object.entries(block.properties).map(([key, value]) => [key, String(value)]))
      : {}
    return { x, y, z, name, properties }
  })
  if (blocks.length === 0) throw new Error('The schematic contains no non-air blocks.')
  if (blocks.length > MAX_BLOCKS) {
    throw new Error(`Schematic contains ${blocks.length} blocks; BUILD_MAX_BLOCKS is ${MAX_BLOCKS}. Increase the limit only if your host has enough memory.`)
  }

  let blockEntities = []
  try {
    if (typeof schematic.getAllBlockEntities === 'function') blockEntities = schematic.getAllBlockEntities()
    else if (typeof schematic.get_all_block_entities === 'function') blockEntities = schematic.get_all_block_entities()
  } catch (error) {
    console.warn('Could not read schematic block-entity data:', error.message)
  }

  return {
    schematic,
    blocks,
    blockEntities: Array.isArray(blockEntities) ? blockEntities : [],
    bytes: bytes.length,
    hash: crypto.createHash('sha256').update(bytes).digest('hex')
  }
}
function readState() {
  try {
    const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
    if (state.schematic === path.resolve(SCHEMATIC_FILE) &&
        state.hash === activeSchematicHash &&
        state.origin?.join(',') === ORIGIN.join(',')) {
      return {
        completed: new Set(Array.isArray(state.completed) ? state.completed : []),
        containersCompleted: new Set(Array.isArray(state.containersCompleted) ? state.containersCompleted : [])
      }
    }
  } catch {}
  return { completed: new Set(), containersCompleted: new Set() }
}

function saveState(completed, status, containersCompleted = new Set()) {
  const temp = STATE_FILE + '.tmp'
  fs.writeFileSync(temp, JSON.stringify({
    schematic: path.resolve(SCHEMATIC_FILE),
    origin: ORIGIN,
    hash: activeSchematicHash,
    completed: [...completed],
    containersCompleted: [...containersCompleted],
    status,
    updatedAt: new Date().toISOString()
  }))
  fs.renameSync(temp, STATE_FILE)
}
function key(pos) {
  return `${pos.x},${pos.y},${pos.z}`
}

function stateMatches(worldBlock, expected) {
  if (!worldBlock || blockName(worldBlock.name) !== expected.name) return false
  if (!expected.properties || Object.keys(expected.properties).length === 0) return true
  let actual = {}
  try {
    actual = typeof worldBlock.getProperties === 'function'
      ? worldBlock.getProperties()
      : (worldBlock.properties || {})
  } catch {}
  return Object.entries(expected.properties).every(([property, value]) =>
    String(actual[property]) === String(value)
  )
}

function facingVector(facing) {
  const vectors = {
    north: new Vec3(0, 0, -1),
    south: new Vec3(0, 0, 1),
    east: new Vec3(1, 0, 0),
    west: new Vec3(-1, 0, 0),
    up: new Vec3(0, 1, 0),
    down: new Vec3(0, -1, 0)
  }
  return vectors[String(facing || '').toLowerCase()] || null
}

function supportDirections(properties = {}) {
  if (properties.face === 'floor') return [new Vec3(0, 1, 0)]
  if (properties.face === 'ceiling') return [new Vec3(0, -1, 0)]
  if (properties.face === 'wall' && facingVector(properties.facing)) return [facingVector(properties.facing)]
  const result = [new Vec3(0, 1, 0)]
  const preferred = facingVector(properties.facing)
  if (preferred && Math.abs(preferred.y) === 0) result.push(preferred)
  for (const vector of [
    new Vec3(1, 0, 0), new Vec3(-1, 0, 0),
    new Vec3(0, 0, 1), new Vec3(0, 0, -1),
    new Vec3(0, -1, 0)
  ]) {
    if (!result.some(entry => entry.x === vector.x && entry.y === vector.y && entry.z === vector.z)) result.push(vector)
  }
  return result
}

function placementOrientations(block) {
  const yaws = []
  const addYaw = value => {
    const normalized = Math.atan2(Math.sin(value), Math.cos(value))
    if (!yaws.some(existing => Math.abs(existing - normalized) < 0.001)) yaws.push(normalized)
  }
  const properties = block.properties || {}
  if (properties.rotation !== undefined && Number.isFinite(Number(properties.rotation))) {
    addYaw(Number(properties.rotation) * Math.PI / 8)
  }
  const byFacing = { south: 0, west: Math.PI / 2, north: Math.PI, east: -Math.PI / 2 }
  if (byFacing[properties.facing] !== undefined) addYaw(byFacing[properties.facing])
  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) addYaw(yaw)
  const pitches = [0]
  if (properties.facing === 'up') pitches.push(-Math.PI / 2, Math.PI / 2)
  if (properties.facing === 'down') pitches.push(Math.PI / 2, -Math.PI / 2)
  return yaws.flatMap(yaw => pitches.map(pitch => ({ yaw, pitch })))
}

function unwrapNbt(value) {
  let current = value
  for (let i = 0; i < 8 && current && typeof current === 'object' &&
      Object.prototype.hasOwnProperty.call(current, 'value') &&
      (typeof current.type === 'string' || Object.keys(current).length <= 2); i++) {
    current = current.value
  }
  return current
}

function entityData(entity) {
  let data = entity?.data ?? entity?.nbt ?? entity
  if (typeof data === 'string') {
    try { data = JSON.parse(data) } catch {}
  }
  return unwrapNbt(data) || {}
}

function entityItems(entity) {
  const data = entityData(entity)
  const candidate = unwrapNbt(data.Items ?? data.items ?? data.value?.Items ?? data.value?.items)
  if (Array.isArray(candidate)) return candidate
  if (candidate && Array.isArray(candidate.value)) return candidate.value
  return []
}

function scalar(value) {
  const result = unwrapNbt(value)
  if (result === null || result === undefined) return result
  if (typeof result === 'object') {
    if (Object.prototype.hasOwnProperty.call(result, 'value')) return scalar(result.value)
    return result
  }
  return result
}

function withTimeout(promise, milliseconds) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('path timeout')), milliseconds)
    Promise.resolve(promise).then(value => {
      clearTimeout(timer)
      resolve(value)
    }, error => {
      clearTimeout(timer)
      reject(error)
    })
  })
}

async function main() {
  if (!SCHEMATIC_FILE || ORIGIN.length !== 3 || !ORIGIN.every(Number.isSafeInteger)) {
    fail('Usage: npm run build -- <file.schem|file.litematic> <originX> <originY> <originZ>')
    return
  }
  if (!fs.existsSync(SCHEMATIC_FILE)) {
    fail('Schematic file not found: ' + SCHEMATIC_FILE)
    return
  }
  if (!Number.isSafeInteger(MAX_BLOCKS) || MAX_BLOCKS < 1 ||
      !Number.isSafeInteger(MAX_ATTEMPTS_PER_BLOCK) || MAX_ATTEMPTS_PER_BLOCK < 1 ||
      !Number.isSafeInteger(BUILD_DELAY_MS) || BUILD_DELAY_MS < 50 ||
      !Number.isSafeInteger(BUILD_MAX_PASSES) || BUILD_MAX_PASSES < 1 || BUILD_MAX_PASSES > 10) {
    fail('BUILD_MAX_BLOCKS, BUILD_BLOCK_ATTEMPTS, or BUILD_DELAY_MS has an invalid value.')
    return
  }

  let loaded
  try {
    loaded = await loadSchematic(SCHEMATIC_FILE)
  } catch (error) {
    fail('Schematic load failed: ' + error.message)
    return
  }

  const { blocks } = loaded
  activeSchematicHash = loaded.hash
  const savedState = readState()
  const completed = savedState.completed
  const containersCompleted = savedState.containersCompleted
  const blockEntitiesByPosition = new Map()
  for (const entity of loaded.blockEntities) {
    const x = Number(entity.x ?? entity.pos?.x)
    const y = Number(entity.y ?? entity.pos?.y)
    const z = Number(entity.z ?? entity.pos?.z)
    if ([x, y, z].every(Number.isSafeInteger)) blockEntitiesByPosition.set(key({ x, y, z }), entity)
  }
  const host = (process.env.MC_HOST || 'myawesomeserverwithf.falix.gg').trim()
  const port = Number.parseInt(process.env.MC_PORT || '25565', 10)
  const username = (process.env.MC_USERNAME || 'bot').trim()
  const version = (process.env.MC_VERSION || '26.3').trim()
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535 ||
      !/^[A-Za-z0-9_]{3,16}$/.test(username) || !version) {
    fail('Invalid MC_HOST, MC_PORT, MC_USERNAME, or MC_VERSION configuration.')
    return
  }

  console.log(`Loaded ${path.basename(SCHEMATIC_FILE)} (${loaded.bytes} bytes), ${blocks.length} non-air blocks.`)
  console.log(`Target origin: ${ORIGIN.join(', ')}. Resume state: ${completed.size} completed blocks.`)
  console.log('Connects in offline mode; the server must permit offline-mode players.')

  let bot
  let mcData = null
  let Item = null
  const creativeSlots = new Map()
  let stopping = false
  let building = false
  let buildCursor = 0
  let activeBuildId = 0
  let failed = new Map()
  let reconnectTimer = null

  const orderedBlocks = blocks.slice().sort((a, b) =>
    (a.y - b.y) || (a.z - b.z) || (a.x - b.x)
  )

  function report() {
    console.log(`Build progress: ${completed.size}/${orderedBlocks.length} saved; ${failed.size} blocked/unavailable.`)
    if (failed.size === 0) return
    const reasons = new Map()
    const materials = new Map()
    for (const result of failed.values()) {
      const status = result?.status || 'unknown'
      reasons.set(status, (reasons.get(status) || 0) + 1)
      if (result?.name) materials.set(result.name, (materials.get(result.name) || 0) + 1)
    }
    console.log('Unresolved reasons: ' + [...reasons].map(([name, count]) => name + '=' + count).join(', '))
    if (materials.size) {
      console.log('Unresolved block types: ' + [...materials].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([name, count]) => name + ' x' + count).join(', '))
    }
  }

  function stopBuild() {
    building = false
    activeBuildId++
    try { bot?.pathfinder?.setGoal(null) } catch {}
  }

  function connect() {
    if (stopping || bot) return
    try {
      bot = mineflayer.createBot({
        host,
        port,
        username,
        auth: 'offline',
        version,
        checkTimeoutInterval: 30000,
        hideErrors: false
      })
    } catch (error) {
      console.error('Minecraft connection could not start:', error.message)
      scheduleReconnect()
      return
    }
    bot.loadPlugin(pathfinder)
    bot.once('spawn', async () => {
      console.log('Connected. Preparing pathfinding and schematic placement.')
      mcData = require('minecraft-data')(bot.version)
      Item = prismarineItem(bot.version)
      const movements = new Movements(bot, mcData)
      movements.canDig = true
      movements.allow1by1towers = true
      movements.allowParkour = true
      movements.allowSprinting = true
      bot.pathfinder.setMovements(movements)
      if (!building) {
        building = true
        const id = ++activeBuildId
        try {
          await runBuild(id)
        } catch (error) {
          console.error('Build stopped after an error:', error.message)
          stopBuild()
        }
      }
    })
    bot.on('kicked', reason => console.warn('Server kicked the builder:', String(reason).slice(0, 300)))
    bot.on('error', error => console.error('Minecraft connection error:', error.message))
    bot.on('end', () => {
      bot = null
      stopBuild()
      saveState(completed, 'disconnected', containersCompleted)
      console.warn('Builder disconnected; saved progress.')
      scheduleReconnect()
    })
  }

  function scheduleReconnect() {
    if (stopping || reconnectTimer) return
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connect()
    }, 10000)
  }

  function itemNameForBlock(name) {
    const plain = name.replace(/^minecraft:/, '')
    const special = {
      redstone_wire: 'redstone',
      water: 'water_bucket',
      lava: 'lava_bucket'
    }
    if (special[plain]) return special[plain]
    const candidates = [plain]
    for (const suffix of ['wall_sign', 'wall_hanging_sign', 'wall_banner', 'wall_head', 'wall_skull', 'wall_torch', 'wall_fan']) {
      if (plain.endsWith(suffix)) candidates.push(plain.replace(suffix, suffix.replace('wall_', '')))
    }
    return candidates.find(candidate => mcData?.itemsByName?.[candidate]) || plain
  }

  async function ensureCreativeItem(block) {
    if (!bot || !Item || !mcData) return null
    const requestedName = itemNameForBlock(block.name)
    const existing = bot.inventory.items().find(entry => entry.name === requestedName && entry.count > 0)
    if (existing) return existing

    const definition = mcData.itemsByName[requestedName]
    if (!definition) return null
    const slot = 36 + (creativeSlots.size % 9)
    creativeSlots.set(requestedName, slot)
    const count = Math.max(1, Math.min(64, Number(definition.stackSize) || 64))
    try {
      await bot.creative.setInventorySlot(slot, new Item(definition.id, count))
      const available = bot.inventory.items().find(entry => entry.name === requestedName && entry.count > 0)
      if (!available) {
        console.warn(`Creative inventory did not provide ${requestedName}; confirm the bot is actually in Creative mode and the server allows creative inventory updates.`)
        return null
      }
      return available
    } catch (error) {
      console.warn(`Could not create ${requestedName} in the bot inventory: ${error.message}`)
      return null
    }
  }

  async function clearTargetIfOccupied(target, expected) {
    const current = bot?.blockAt(target)
    if (!current || isAir(current.name) || stateMatches(current, expected)) return true
    if (current.boundingBox === 'empty') return true
    try {
      await bot.dig(current, true)
      await delay(100)
    } catch (error) {
      return false
    }
    const after = bot.blockAt(target)
    return !after || isAir(after.name) || after.boundingBox === 'empty'
  }

  function containerItemInfo(entry) {
    const rawItem = scalar(entry?.item ?? entry?.Item ?? entry)
    const rawId = scalar(rawItem?.id ?? rawItem?.Id ?? rawItem?.name)
    if (rawId === undefined || rawId === null) return null
    let itemName = String(rawId)
    if (/^\d+$/.test(itemName)) itemName = mcData?.items?.[Number(itemName)]?.name || itemName
    itemName = itemName.replace(/^minecraft:/, '')
    const definition = mcData?.itemsByName?.[itemName]
    if (!definition) return null
    const rawCount = scalar(rawItem?.Count ?? rawItem?.count ?? rawItem?.amount ?? entry?.Count ?? entry?.count)
    const count = Math.max(1, Math.min(Number(definition.stackSize) || 64, Number(rawCount) || 1))
    const rawSlot = scalar(entry?.Slot ?? entry?.slot)
    const slot = Number.isInteger(Number(rawSlot)) ? Number(rawSlot) : null
    const rawMetadata = scalar(rawItem?.Damage ?? rawItem?.damage ?? rawItem?.metadata)
    const metadata = Number.isFinite(Number(rawMetadata)) ? Number(rawMetadata) : 0
    const rawTag = rawItem?.tag ?? rawItem?.Tag
    const nbt = rawTag && typeof rawTag === 'object' && typeof rawTag.type === 'string' && 'value' in rawTag ? rawTag : null
    return { definition, count, slot, metadata, nbt }
  }

  async function restoreContainerContents(id) {
    for (const [localKey, entity] of blockEntitiesByPosition) {
      if (stopping || id !== activeBuildId || !bot) return
      const items = entityItems(entity)
      if (items.length === 0 || containersCompleted.has(localKey)) continue
      const localPos = localKey.split(',').map(Number)
      const target = new Vec3(ORIGIN[0] + localPos[0], ORIGIN[1] + localPos[1], ORIGIN[2] + localPos[2])
      const name = blockEntitiesByPosition.get(localKey)?.name || 'block entity'
      try {
        const moved = await moveNear(target, id)
        if (!moved || !bot || id !== activeBuildId) return
        const block = bot.blockAt(target)
        if (!block || isAir(block.name)) {
          console.warn(`Skipping saved container contents at ${key(target)}: target block is missing.`)
          continue
        }
        const container = await bot.openContainer(block)
        let allCopied = true
        const entries = items.map(containerItemInfo)
        for (let index = 0; index < items.length; index++) {
          const data = entries[index]
          if (!data) {
            allCopied = false
            console.warn(`Unsupported container item at ${key(target)}; its item data was not recognized.`)
            continue
          }
          const destination = data.slot === null ? index : data.slot
          if (!Number.isInteger(destination) || destination < 0 || destination >= container.inventoryStart) {
            allCopied = false
            console.warn(`Container slot ${destination} is invalid for ${block.name} at ${key(target)}.`)
            continue
          }
          const current = container.slots[destination]
          if (current && current.name === data.definition.name && current.count === data.count) continue
          if (current) {
            allCopied = false
            console.warn(`Container slot ${destination} at ${key(target)} is already occupied; leaving it unchanged.`)
            continue
          }
          const hotbarIndex = index % 9
          const playerSlot = 36 + hotbarIndex
          const activeWindowSlot = container.inventoryStart + 27 + hotbarIndex
          try {
            await bot.creative.setInventorySlot(playerSlot, new Item(data.definition.id, data.count, data.metadata, data.nbt))
            await bot.clickWindow(activeWindowSlot, 0, 0)
            await bot.clickWindow(destination, 0, 0)
            await delay(BUILD_DELAY_MS)
            const placed = container.slots[destination]
            if (!placed || placed.name !== data.definition.name || placed.count !== data.count) {
              allCopied = false
              console.warn(`Could not verify ${data.definition.name} x${data.count} in slot ${destination} at ${key(target)}.`)
            }
          } catch (error) {
            allCopied = false
            console.warn(`Could not restore container item at ${key(target)} slot ${destination}: ${error.message}`)
          }
        }
        try { container.close() } catch {}
        if (allCopied) {
          containersCompleted.add(localKey)
          saveState(completed, 'building', containersCompleted)
        }
      } catch (error) {
        console.warn(`Could not restore contents for ${name} at ${key(target)}: ${error.message}`)
      }
    }
  }

  function targetPos(block) {
    return new Vec3(ORIGIN[0] + block.x, ORIGIN[1] + block.y, ORIGIN[2] + block.z)
  }

  async function moveNear(target, id) {
    const candidates = [
      target.offset(1, 0, 0), target.offset(-1, 0, 0),
      target.offset(0, 0, 1), target.offset(0, 0, -1),
      target.offset(0, 1, 0), target.offset(0, -1, 0)
    ]
    let lastError
    for (const stand of candidates) {
      if (id !== activeBuildId || !bot) return false
      try {
        await withTimeout(bot.pathfinder.goto(new goals.GoalNear(stand.x, stand.y, stand.z, 1)), 30000)
        if (id !== activeBuildId || !bot) return false
        return true
      } catch (error) {
        lastError = error
      } finally {
        try { bot?.pathfinder?.setGoal(null) } catch {}
      }
    }
    if (lastError) throw lastError
    return false
  }

  async function placeTarget(block, target, id) {
    let item = await ensureCreativeItem(block)
    if (!item) return { status: 'unavailable-item', name: block.name }

    if (!await clearTargetIfOccupied(target, block)) {
      return { status: 'target-obstructed', name: block.name }
    }

    const faces = supportDirections(block.properties)
    const orientations = placementOrientations(block)
    let sawSupport = false
    let lastReason = 'placement-failed'
    for (const direction of faces) {
      if (id !== activeBuildId || !bot) return { status: 'cancelled' }
      const referencePosition = target.minus(direction)
      const reference = bot.blockAt(referencePosition)
      if (!reference || isAir(reference.name) || reference.boundingBox !== 'block') continue
      sawSupport = true

      const reached = await moveNear(reference.position, id).catch(() => false)
      if (!reached || id !== activeBuildId || !bot) continue

      for (const orientation of orientations) {
        if (id !== activeBuildId || !bot) return { status: 'cancelled' }
        item = await ensureCreativeItem(block)
        if (!item) return { status: 'unavailable-item', name: block.name }
        try {
          await bot.equip(item, 'hand')
          await bot.look(orientation.yaw, orientation.pitch, true)
          await bot.placeBlock(reference, direction)
          await delay(BUILD_DELAY_MS)
          const after = bot.blockAt(target)
          if (stateMatches(after, block)) return { status: 'placed' }

          // Many blocks derive their facing/rotation from the player's look direction.
          // In Creative, remove a wrongly-oriented attempt and test the next orientation.
          if (after && !isAir(after.name) && after.boundingBox !== 'empty') {
            try { await bot.dig(after, true) } catch {}
            await delay(Math.max(100, BUILD_DELAY_MS))
          }
          lastReason = after && blockName(after.name) === block.name ? 'state-mismatch' : 'placement-failed'
        } catch (error) {
          lastReason = error.message || 'placement-failed'
          await delay(BUILD_DELAY_MS)
        }
      }
    }
    return { status: sawSupport ? lastReason : 'no-support', name: block.name }
  }
  async function runBuild(id) {
    const failed = new Map()
    for (let pass = 1; pass <= BUILD_MAX_PASSES; pass++) {
      let progressThisPass = 0
      console.log(`Build pass ${pass}/${BUILD_MAX_PASSES}: ${completed.size}/${orderedBlocks.length} blocks already verified.`)

      for (buildCursor = 0; buildCursor < orderedBlocks.length; buildCursor++) {
        if (stopping || id !== activeBuildId || !bot) return
        const block = orderedBlocks[buildCursor]
        const target = targetPos(block)
        const targetKey = key(target)
        const existing = bot.blockAt(target)

        // Always verify saved positions against the live world; server resets or
        // incorrect prior orientations must not be hidden by the checkpoint.
        if (stateMatches(existing, block)) {
          if (!completed.has(targetKey)) {
            completed.add(targetKey)
            saveState(completed, 'building', containersCompleted)
          }
          failed.delete(targetKey)
          continue
        }
        completed.delete(targetKey)

        let result
        for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_BLOCK; attempt++) {
          if (id !== activeBuildId || !bot) return
          result = await placeTarget(block, target, id)
          if (result.status === 'placed') break
          if (result.status === 'cancelled') return
          if (result.status === 'unavailable-item' || result.status === 'no-support' || result.status === 'target-obstructed') break
          await delay(BUILD_DELAY_MS * attempt)
        }

        if (result?.status === 'placed') {
          completed.add(targetKey)
          failed.delete(targetKey)
          progressThisPass++
          saveState(completed, 'building', containersCompleted)
        } else {
          failed.set(targetKey, result || { status: 'unknown', name: block.name })
        }

        if (completed.size > 0 && completed.size % 25 === 0) report()
        if (buildCursor % 10 === 0) await delay(BUILD_DELAY_MS)
      }

      if (progressThisPass === 0) break
    }

    await restoreContainerContents(id)
    saveState(completed, failed.size ? 'finished-with-unresolved-blocks' : 'finished', containersCompleted)
    report()
    if (failed.size) {
      console.warn('Some blocks could not be placed. Check unresolved reasons above. The builder made multiple passes so blocks that needed a later support/neighbor can be retried.')
    } else {
      console.log('Schematic block placement pass completed.')
    }
    stopBuild()
  }
  function shutdown() {
    if (stopping) return
    stopping = true
    clearTimeout(reconnectTimer)
    stopBuild()
    saveState(completed, 'stopped', containersCompleted)
    try { bot?.quit('Schematic builder stopped') } catch {}
    setTimeout(() => process.exit(0), 250).unref()
  }

  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
  connect()
}

main().catch(error => fail(error.message))
