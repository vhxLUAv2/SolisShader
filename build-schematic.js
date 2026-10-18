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
const BUILD_ARGS = process.argv.slice(2)
const HAS_EXPLICIT_SCHEMATIC = /\.(?:schem|litematic)$/i.test(BUILD_ARGS[0] || '')
let activeSchematicHash = null
let SCHEMATIC_FILE = HAS_EXPLICIT_SCHEMATIC ? path.resolve(BUILD_ARGS[0]) : null
const ORIGIN_ARGS = HAS_EXPLICIT_SCHEMATIC ? BUILD_ARGS.slice(1) : BUILD_ARGS
const ORIGIN = ORIGIN_ARGS.length === 0
  ? [
      Number.parseInt(process.env.BUILD_ORIGIN_X || '100', 10),
      Number.parseInt(process.env.BUILD_ORIGIN_Y || '64', 10),
      Number.parseInt(process.env.BUILD_ORIGIN_Z || '100', 10)
    ]
  : ORIGIN_ARGS.map(Number)

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

function normalizeBlockProperties(properties) {
  if (Array.isArray(properties)) {
    return Object.fromEntries(properties
      .filter(entry => Array.isArray(entry) && entry.length >= 2)
      .map(([key, value]) => [String(key), String(value)]))
  }
  if (properties && typeof properties === 'object') {
    return Object.fromEntries(Object.entries(properties).map(([key, value]) => [String(key), String(value)]))
  }
  return {}
}

async function loadSchematic(file) {
  const { Schematic } = await import('nucleation')
  const bytes = fs.readFileSync(file)
  let schematic
  try {
    schematic = Schematic.fromData(bytes)
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
    const properties = normalizeBlockProperties(block.properties)
    return { x, y, z, name, properties }
  })
  if (blocks.length === 0) throw new Error('The schematic contains no non-air blocks.')
  if (blocks.length > MAX_BLOCKS) {
    throw new Error(`Schematic contains ${blocks.length} blocks; BUILD_MAX_BLOCKS is ${MAX_BLOCKS}. Increase the limit only if your host has enough memory.`)
  }

  let blockEntities = []
  try {
    if (typeof schematic.getAllBlockEntities === 'function') blockEntities = schematic.getAllBlockEntities()
    else if (typeof schematic.getAllBlockEntitiesJson === 'function') blockEntities = JSON.parse(schematic.getAllBlockEntitiesJson())
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

function supportDirections(block) {
  const name = block.name
  const properties = block.properties || {}
  if (properties.face === 'floor') return [new Vec3(0, 1, 0)]
  if (properties.face === 'ceiling') return [new Vec3(0, -1, 0)]
  if (properties.face === 'wall' && facingVector(properties.facing)) return [facingVector(properties.facing)]

  // Logs/pillars orient from the face clicked, so prioritize the requested axis.
  if (properties.axis === 'x') return [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 1, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)]
  if (properties.axis === 'z') return [new Vec3(0, 0, 1), new Vec3(0, 0, -1), new Vec3(0, 1, 0), new Vec3(1, 0, 0), new Vec3(-1, 0, 0)]

  // Slab halves are easier to select from a side face using the click height.
  const sideFaces = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)]
  if ((name.endsWith('_slab') && ['top', 'bottom'].includes(properties.type)) ||
      (name.endsWith('_stairs') && ['top', 'bottom'].includes(properties.half))) {
    return [...sideFaces, new Vec3(0, 1, 0), new Vec3(0, -1, 0)]
  }

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

function isAutoPlacedCompanion(block) {
  const name = block.name
  const properties = block.properties || {}
  if (name.endsWith('_bed') && properties.part === 'head') return true
  if (properties.half === 'upper') {
    if (name.endsWith('_door')) return true
    if ([
      'minecraft:sunflower', 'minecraft:lilac', 'minecraft:rose_bush',
      'minecraft:peony', 'minecraft:tall_grass', 'minecraft:large_fern',
      'minecraft:pitcher_plant', 'minecraft:tall_seagrass'
    ].includes(name)) return true
  }
  return false
}

function neighborDerivedProperties(name) {
  if (name === 'minecraft:chest' || name === 'minecraft:trapped_chest') return new Set(['type'])
  if (name === 'minecraft:rail' || name.endsWith('_rail')) return new Set(['shape', 'powered'])
  if (name.endsWith('_stairs')) return new Set(['shape'])
  if (name.endsWith('_fence') || name.endsWith('_pane') ||
      name.endsWith('_wall') || name === 'minecraft:iron_bars') {
    return new Set(['north', 'east', 'south', 'west', 'up'])
  }
  if (name === 'minecraft:redstone_wire') return new Set(['north', 'east', 'south', 'west', 'power'])
  if (name === 'minecraft:chorus_plant') return new Set(['north', 'east', 'south', 'west', 'up', 'down'])
  if (name.endsWith('_door')) return new Set(['open', 'powered'])
  return new Set()
}

function stableStateMatches(worldBlock, expected) {
  if (!worldBlock || blockName(worldBlock.name) !== expected.name) return false
  const ignored = neighborDerivedProperties(expected.name)
  const props = expected.properties || {}
  let actual = {}
  try {
    actual = typeof worldBlock.getProperties === 'function'
      ? worldBlock.getProperties()
      : (worldBlock.properties || {})
  } catch {}
  return Object.entries(props).every(([property, value]) =>
    ignored.has(property) || String(actual[property]) === String(value)
  )
}

function placementOrientations(block) {
  const yaws = []
  const addYaw = value => {
    const normalized = Math.atan2(Math.sin(value), Math.cos(value))
    if (!yaws.some(existing => Math.abs(existing - normalized) < 0.001)) yaws.push(normalized)
  }
  const properties = block.properties || {}
  if (properties.rotation !== undefined && Number.isFinite(Number(properties.rotation))) {
    // Test the expected yaw first, then sweep all 16 states so we verify the
    // actual server orientation instead of assuming a particular angle mapping.
    addYaw(Number(properties.rotation) * Math.PI / 8)
    for (let step = 0; step < 16; step++) addYaw(step * Math.PI / 8)
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
  const tagNames = new Set([
    'Byte', 'Short', 'Int', 'Long', 'Float', 'Double',
    'ByteArray', 'String', 'List', 'Compound', 'IntArray', 'LongArray'
  ])
  for (let i = 0; i < 12 && current && typeof current === 'object' && !Array.isArray(current); i++) {
    // Nucleation serializes NBT as tagged JSON, e.g. { String: "minecraft:diamond" }
    // or { List: [{ Compound: { id: { String: ... }, Count: { Byte: 3 } } }] }.
    if (Object.prototype.hasOwnProperty.call(current, 'value') &&
        (typeof current.type === 'string' || Object.keys(current).length <= 2)) {
      current = current.value
      continue
    }
    const keys = Object.keys(current)
    if (keys.length === 1 && tagNames.has(keys[0])) {
      current = current[keys[0]]
      continue
    }
    break
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

function entityInventory(entity) {
  const data = entityData(entity)
  const raw = data.Items ?? data.items ?? data.value?.Items ?? data.value?.items
  if (raw === undefined || raw === null) return { hasItems: false, items: [] }
  const candidate = unwrapNbt(raw)
  if (Array.isArray(candidate)) return { hasItems: true, items: candidate }
  if (candidate && Array.isArray(candidate.value)) return { hasItems: true, items: candidate.value }
  return { hasItems: false, items: [] }
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

function toPrismarineNbt(value) {
  if (value === null || value === undefined) return null
  if (typeof value !== 'object') return value
  if (typeof value.type === 'string' && Object.prototype.hasOwnProperty.call(value, 'value')) return value

  const variants = {
    Byte: 'byte', Short: 'short', Int: 'int', Long: 'long',
    Float: 'float', Double: 'double', ByteArray: 'byteArray',
    String: 'string', List: 'list', Compound: 'compound',
    IntArray: 'intArray', LongArray: 'longArray'
  }
  const keys = Object.keys(value)
  if (keys.length === 1 && variants[keys[0]]) {
    const kind = keys[0]
    const raw = value[kind]
    if (kind === 'Compound') {
      const compound = raw && typeof raw === 'object' ? raw : {}
      return {
        type: 'compound',
        value: Object.fromEntries(Object.entries(compound).map(([key, nested]) => [key, toPrismarineNbt(nested)]))
      }
    }
    if (kind === 'List') {
      const entries = Array.isArray(raw) ? raw : []
      const converted = entries.map(toPrismarineNbt)
      const childType = converted[0]?.type || 'end'
      return { type: 'list', value: { type: childType, value: converted.map(tag => tag?.value ?? tag) } }
    }
    return { type: variants[kind], value: raw }
  }

  // Accept a plain JSON compound as well as tagged JSON from Nucleation.
  return {
    type: 'compound',
    value: Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, toPrismarineNbt(nested)]))
  }
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
  if (!SCHEMATIC_FILE) {
    const schematicDirectory = path.resolve(process.env.SCHEMATICS_DIR || './schematics')
    let candidates = []
    try {
      candidates = fs.readdirSync(schematicDirectory, { withFileTypes: true })
        .filter(entry => entry.isFile() && /\.(?:schem|litematic)$/i.test(entry.name))
        .map(entry => path.join(schematicDirectory, entry.name))
        .sort((a, b) => a.localeCompare(b))
    } catch (error) {
      fail(`Could not read schematic directory ${schematicDirectory}: ${error.message}`)
      return
    }

    if (candidates.length === 0) {
      fail(`No .schem or .litematic files found in ${schematicDirectory}. Upload a schematic there first.`)
      return
    }
    if (candidates.length > 1) {
      fail('More than one schematic was found. Leave only the one to build in ' +
        schematicDirectory + ' or pass its filename explicitly: ' +
        candidates.map(file => path.basename(file)).join(', '))
      return
    }

    SCHEMATIC_FILE = candidates[0]
    console.log('Auto-detected schematic: ' + path.basename(SCHEMATIC_FILE))
  }

  if (ORIGIN.length !== 3 || !ORIGIN.every(Number.isSafeInteger)) {
    fail('Origin must be three whole-number coordinates. Use npm run build -- <x> <y> <z>, or set BUILD_ORIGIN_X, BUILD_ORIGIN_Y, and BUILD_ORIGIN_Z.')
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
    // Nucleation returns { id, position: [x, y, z], nbt }, not x/y/z at top level.
    const position = entity.position ?? entity.pos
    const x = Number(entity.x ?? position?.x ?? (Array.isArray(position) ? position[0] : undefined))
    const y = Number(entity.y ?? position?.y ?? (Array.isArray(position) ? position[1] : undefined))
    const z = Number(entity.z ?? position?.z ?? (Array.isArray(position) ? position[2] : undefined))
    if ([x, y, z].every(Number.isSafeInteger)) blockEntitiesByPosition.set(key({ x, y, z }), entity)
    else console.warn('Ignoring schematic block entity with an unrecognized position:', entity.id || 'unknown')
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
    const rawSlot = scalar(entry?.Slot ?? entry?.slot ?? rawItem?.Slot ?? rawItem?.slot)
    const slot = rawSlot === undefined || rawSlot === null ? null : Number.isInteger(Number(rawSlot)) ? Number(rawSlot) : null
    const rawMetadata = scalar(rawItem?.Damage ?? rawItem?.damage ?? rawItem?.metadata)
    const metadata = Number.isFinite(Number(rawMetadata)) ? Number(rawMetadata) : 0
    const rawTag = rawItem?.tag ?? rawItem?.Tag
    const convertedTag = rawTag == null ? null : toPrismarineNbt(rawTag)
    const nbt = convertedTag?.type === 'compound' ? convertedTag : null
    const components = rawItem?.components ?? rawItem?.Components
    return { definition, count, slot, metadata, nbt, components }
  }

  async function withScratchHotbar(container, hotbarIndex, targetSlot, operation) {
    const playerSlot = 36 + hotbarIndex
    const activeWindowSlot = container.inventoryStart + 27 + hotbarIndex
    const originalItem = bot.inventory.slots[playerSlot] || null

    // Preserve the bot's own hotbar item while temporarily moving Creative-created
    // stacks through the player inventory to a container slot.
    await bot.creative.clearSlot(playerSlot)
    try {
      return await operation({ playerSlot, activeWindowSlot })
    } finally {
      try {
        if (container.selectedItem) await bot.clickWindow(targetSlot, 0, 0)
      } catch {}
      try {
        await bot.creative.clearSlot(playerSlot)
        if (originalItem) await bot.creative.setInventorySlot(playerSlot, originalItem)
      } catch (error) {
        console.warn(`Could not restore hotbar slot ${playerSlot}: ${error.message}`)
      }
    }
  }

  function containerItemMatches(current, data) {
    if (!current || current.name !== data.definition.name || current.count !== data.count) return false
    if (data.components && Object.keys(data.components).length > 0) {
      // prismarine-item exposes component arrays on newer versions, while the schematic
      // parser returns structured NBT JSON. Don't pretend these different forms match.
      return Array.isArray(current.components) && JSON.stringify(current.components) === JSON.stringify(data.components)
    }
    const wanted = new Item(data.definition.id, data.count, data.metadata, data.nbt)
    return Item.equal(current, wanted, true, true)
  }

  async function clearContainerSlot(container, targetSlot, locationKey) {
    const hotbarIndex = targetSlot % 9
    return withScratchHotbar(container, hotbarIndex, targetSlot, async ({ activeWindowSlot }) => {
      try {
        await bot.clickWindow(targetSlot, 0, 0)
        await bot.clickWindow(activeWindowSlot, 0, 0)
        await delay(BUILD_DELAY_MS)
        const stillThere = container.slots[targetSlot]
        if (stillThere) {
          console.warn(`Could not clear existing item from container slot ${targetSlot} at ${locationKey}.`)
          return false
        }
        return true
      } catch (error) {
        console.warn(`Could not clear container slot ${targetSlot} at ${locationKey}: ${error.message}`)
        return false
      }
    })
  }

  async function putContainerItem(container, targetSlot, data, locationKey, index) {
    const hotbarIndex = index % 9
    const wanted = new Item(data.definition.id, data.count, data.metadata, data.nbt)
    return withScratchHotbar(container, hotbarIndex, targetSlot, async ({ playerSlot, activeWindowSlot }) => {
      try {
        await bot.creative.setInventorySlot(playerSlot, wanted)
        await bot.clickWindow(activeWindowSlot, 0, 0)
        await bot.clickWindow(targetSlot, 0, 0)
        await delay(BUILD_DELAY_MS)
        const placed = container.slots[targetSlot]
        if (!containerItemMatches(placed, data)) {
          console.warn(`Could not verify ${data.definition.name} x${data.count} in slot ${targetSlot} at ${locationKey}.`)
          return false
        }
        return true
      } catch (error) {
        console.warn(`Could not place ${data.definition.name} x${data.count} in container slot ${targetSlot} at ${locationKey}: ${error.message}`)
        return false
      }
    })
  }

  async function restoreContainerContents(id) {
    for (const [localKey, entity] of blockEntitiesByPosition) {
      if (stopping || id !== activeBuildId || !bot) return
      const inventory = entityInventory(entity)
      if (!inventory.hasItems) continue

      const items = inventory.items
      const localPos = localKey.split(',').map(Number)
      const target = new Vec3(ORIGIN[0] + localPos[0], ORIGIN[1] + localPos[1], ORIGIN[2] + localPos[2])
      const name = entity.id || 'block entity'
      try {
        const moved = await moveNear(target, id)
        if (!moved || !bot || id !== activeBuildId) return
        const block = bot.blockAt(target)
        if (!block || isAir(block.name)) {
          console.warn(`Skipping saved inventory at ${key(target)}: target block is missing.`)
          continue
        }

        const container = await bot.openContainer(block)
        let allCopied = true
        const expectedBySlot = new Map()
        for (let index = 0; index < items.length; index++) {
          const data = containerItemInfo(items[index])
          if (!data) {
            allCopied = false
            console.warn(`Unsupported saved item at ${key(target)} entry ${index}; its inventory slot cannot be reconstructed.`)
            continue
          }
          const slot = data.slot === null ? index : data.slot
          if (!Number.isInteger(slot) || slot < 0 || slot >= container.inventoryStart) {
            allCopied = false
            console.warn(`Container slot ${slot} is invalid for ${block.name} at ${key(target)}.`)
            continue
          }
          if (expectedBySlot.has(slot)) {
            allCopied = false
            console.warn(`Duplicate saved inventory slot ${slot} for ${block.name} at ${key(target)}.`)
            continue
          }
          expectedBySlot.set(slot, data)
        }

        // Make the live container match the saved slot map. Empty slots in the
        // schematic are cleared as well, rather than leaving stale world contents.
        for (let slot = 0; slot < container.inventoryStart; slot++) {
          if (stopping || id !== activeBuildId || !bot) {
            allCopied = false
            break
          }
          const current = container.slots[slot]
          if (!current) continue
          const expected = expectedBySlot.get(slot)
          if (expected && containerItemMatches(current, expected)) continue
          if (expected?.components && Object.keys(expected.components).length > 0 &&
              current.name === expected.definition.name && current.count === expected.count) {
            allCopied = false
            console.warn(`Custom data/components in slot ${slot} at ${key(target)} cannot be verified safely; preserving the existing stack.`)
            continue
          }
          if (expected?.components && Object.keys(expected.components).length > 0) {
            allCopied = false
            console.warn(`Custom components for ${expected.definition.name} at ${key(target)} cannot be recreated safely; preserving slot ${slot}.`)
            continue
          }
          if (!await clearContainerSlot(container, slot, key(target))) {
            allCopied = false
          }
        }

        for (const [slot, data] of expectedBySlot) {
          if (stopping || id !== activeBuildId || !bot) {
            allCopied = false
            break
          }
          if (containerItemMatches(container.slots[slot], data)) continue
          if (container.slots[slot]) {
            allCopied = false
            console.warn(`Container slot ${slot} at ${key(target)} is still occupied; refusing to overwrite it.`)
            continue
          }
          if (data.components && Object.keys(data.components).length > 0) {
            allCopied = false
            console.warn(`Custom components for ${data.definition.name} at ${key(target)} cannot be recreated safely.`)
            continue
          }
          if (!await putContainerItem(container, slot, data, key(target), slot)) allCopied = false
        }

        try { container.close() } catch {}
        if (allCopied) {
          containersCompleted.add(localKey)
          saveState(completed, 'building', containersCompleted)
        } else {
          containersCompleted.delete(localKey)
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
    if (isAutoPlacedCompanion(block)) {
      const existing = bot?.blockAt(target)
      if (existing && !isAir(existing.name) &&
          !stateMatches(existing, block) &&
          !stableStateMatches(existing, block) &&
          !await clearTargetIfOccupied(target, block)) {
        return { status: 'target-obstructed', name: block.name }
      }
      return { status: 'companion-managed', name: block.name }
    }

    let item = await ensureCreativeItem(block)
    if (!item) return { status: 'unavailable-item', name: block.name }

    if (!await clearTargetIfOccupied(target, block)) {
      return { status: 'target-obstructed', name: block.name }
    }

    const faces = supportDirections(block)
    const orientations = placementOrientations(block)
    const properties = block.properties || {}
    const placementHalf = ['top', 'bottom'].includes(properties.half)
      ? properties.half
      : (block.name.endsWith('_slab') && ['top', 'bottom'].includes(properties.type) ? properties.type : undefined)
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
          if (typeof bot._placeBlockWithOptions === 'function') {
            // Public placeBlock adjusts the view toward the clicked face and overrides
            // the yaw we are testing. This path leaves our chosen view unchanged.
            await bot._placeBlockWithOptions(reference, direction, {
              forceLook: 'ignore',
              swingArm: 'right',
              ...(placementHalf ? { half: placementHalf } : {})
            })
          } else {
            await bot.placeBlock(reference, direction)
          }
          await delay(BUILD_DELAY_MS)
          const after = bot.blockAt(target)
          if (stateMatches(after, block)) return { status: 'placed' }

          // Preserve a correctly oriented block while neighbor-derived properties settle.
          if (stableStateMatches(after, block)) {
            lastReason = 'pending-neighbors'
            return { status: 'pending-neighbors', name: block.name }
          }

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
    failed.clear()
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
        if (stableStateMatches(existing, block)) {
          failed.set(targetKey, { status: 'pending-neighbors', name: block.name })
          continue
        }

        let result
        for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_BLOCK; attempt++) {
          if (id !== activeBuildId || !bot) return
          result = await placeTarget(block, target, id)
          if (result.status === 'placed') break
          if (result.status === 'cancelled') return
          if (['unavailable-item', 'no-support', 'target-obstructed', 'companion-managed', 'pending-neighbors'].includes(result.status)) break
          await delay(BUILD_DELAY_MS * attempt)
        }

        if (result?.status === 'placed') {
          completed.add(targetKey)
          failed.delete(targetKey)
          progressThisPass++
          saveState(completed, 'building', containersCompleted)
          if (progressThisPass % 25 === 0) report()
        } else {
          failed.set(targetKey, result || { status: 'unknown', name: block.name })
        }

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
