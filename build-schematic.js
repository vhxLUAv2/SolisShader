'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { setTimeout: delay } = require('node:timers/promises')
const mineflayer = require('@wp2508/mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const Vec3 = require('vec3').Vec3

const MAX_BLOCKS = Number.parseInt(process.env.BUILD_MAX_BLOCKS || '50000', 10)
const MAX_ATTEMPTS_PER_BLOCK = Number.parseInt(process.env.BUILD_BLOCK_ATTEMPTS || '3', 10)
const BUILD_DELAY_MS = Number.parseInt(process.env.BUILD_DELAY_MS || '250', 10)
const STATE_FILE = path.resolve(process.env.BUILD_STATE_FILE || './build-state.json')
const SCHEMATIC_FILE = process.argv[2]
const ORIGIN = process.argv.slice(3, 6).map(Number)

function fail(message) {
  console.error(message)
  process.exitCode = 1
}

function readInteger(value, name) {
  if (!Number.isSafeInteger(value)) throw new Error(`${name} must be a whole number.`)
  return value
}

function isAir(name) {
  return !name || name === 'minecraft:air' || name === 'minecraft:cave_air' || name === 'minecraft:void_air'
}

function blockName(name) {
  return String(name || '').split('[')[0].split('{')[0]
}

async function loadSchematic(file) {
  const { Schematic } = await import('nucleation')
  const bytes = fs.readFileSync(file)
  const schematic = Schematic.fromData(Array.from(bytes))
  let blocks
  try {
    blocks = JSON.parse(schematic.getNonAirBlocksJson())
  } catch (error) {
    throw new Error('Could not read non-air blocks from the schematic: ' + error.message)
  }
  if (!Array.isArray(blocks)) throw new Error('The schematic parser returned an invalid block list.')
  if (blocks.length === 0) throw new Error('The schematic contains no non-air blocks.')
  if (blocks.length > MAX_BLOCKS) {
    throw new Error(`Schematic contains ${blocks.length} blocks; BUILD_MAX_BLOCKS is ${MAX_BLOCKS}. Increase the limit only if your host has enough memory.`)
  }
  const normalized = blocks.map((block, index) => {
    const x = Number(block.x)
    const y = Number(block.y)
    const z = Number(block.z)
    const name = blockName(block.name)
    if (![x, y, z].every(Number.isSafeInteger) || !name) {
      throw new Error(`Invalid block entry at index ${index}.`)
    }
    return { x, y, z, name }
  })
  return { schematic, blocks: normalized, bytes: bytes.length }
}

function readState() {
  try {
    const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
    if (state.schematic === path.resolve(SCHEMATIC_FILE) &&
        state.origin?.join(',') === ORIGIN.join(',')) {
      return new Set(Array.isArray(state.completed) ? state.completed : [])
    }
  } catch {}
  return new Set()
}

function saveState(completed, status) {
  const temp = STATE_FILE + '.tmp'
  fs.writeFileSync(temp, JSON.stringify({
    schematic: path.resolve(SCHEMATIC_FILE),
    origin: ORIGIN,
    completed: [...completed],
    status,
    updatedAt: new Date().toISOString()
  }))
  fs.renameSync(temp, STATE_FILE)
}

function key(pos) {
  return `${pos.x},${pos.y},${pos.z}`
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
      !Number.isSafeInteger(BUILD_DELAY_MS) || BUILD_DELAY_MS < 50) {
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
  const completed = readState()
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
  let stopping = false
  let building = false
  let buildCursor = 0
  let activeBuildId = 0
  let completedCount = 0
  let failed = new Map()
  let pathfinderPlugin
  let reconnectTimer = null

  const orderedBlocks = blocks.slice().sort((a, b) =>
    (a.y - b.y) || (a.z - b.z) || (a.x - b.x)
  )

  function report() {
    console.log(`Build progress: ${completed.size}/${orderedBlocks.length} saved; ${failed.size} blocked/unavailable.`)
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
      const mcData = require('minecraft-data')(bot.version)
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
      saveState(completed, 'disconnected')
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
        bot.pathfinder.setGoal(new goals.GoalNear(stand.x, stand.y, stand.z, 1))
        await Promise.race([
          new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('path timeout')), 30000)
            bot.once('goal_reached', () => { clearTimeout(timeout); resolve() })
            bot.once('path_reset', () => { clearTimeout(timeout); reject(new Error('path reset')) })
          }),
          delay(30000).then(() => { throw new Error('path timeout') })
        ])
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
    const itemName = block.name.replace(/^minecraft:/, '')
    const item = bot.inventory.items().find(entry => entry.name === itemName)
    if (!item) return { status: 'missing-material', name: block.name }

    const faces = [
      new Vec3(0, -1, 0), new Vec3(0, 1, 0),
      new Vec3(1, 0, 0), new Vec3(-1, 0, 0),
      new Vec3(0, 0, 1), new Vec3(0, 0, -1)
    ]
    let reference = null
    let face = null
    for (const direction of faces) {
      const candidate = target.minus(direction)
      const worldBlock = bot.blockAt(candidate)
      if (worldBlock && worldBlock.boundingBox === 'block' && worldBlock.name !== 'air' &&
          worldBlock.name !== 'cave_air' && worldBlock.name !== 'void_air') {
        reference = worldBlock
        face = direction
        break
      }
    }
    if (!reference) return { status: 'no-support', name: block.name }

    try {
      const reached = await moveNear(reference.position, id)
      if (!reached || id !== activeBuildId || !bot) return { status: 'cancelled' }
      const current = bot.blockAt(target)
      if (current && blockName(current.name) === block.name) return { status: 'placed' }
      await bot.equip(item, 'hand')
      await bot.lookAt(reference.position.plus(face.scaled(0.5)), true)
      await bot.placeBlock(reference, face)
      await delay(BUILD_DELAY_MS)
      const after = bot.blockAt(target)
      if (after && blockName(after.name) === block.name) return { status: 'placed' }
      return { status: 'placement-failed', name: block.name }
    } catch (error) {
      return { status: 'placement-failed', name: block.name, reason: error.message }
    }
  }

  async function runBuild(id) {
    let placedThisRun = 0
    for (buildCursor = 0; buildCursor < orderedBlocks.length; buildCursor++) {
      if (stopping || id !== activeBuildId || !bot) return
      const block = orderedBlocks[buildCursor]
      const target = targetPos(block)
      const targetKey = key(target)
      if (completed.has(targetKey)) continue
      const existing = bot.blockAt(target)
      if (existing && blockName(existing.name) === block.name) {
        completed.add(targetKey)
        completedCount++
        saveState(completed, 'building')
        continue
      }

      let result
      for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_BLOCK; attempt++) {
        if (id !== activeBuildId || !bot) return
        result = await placeTarget(block, target, id)
        if (result.status === 'placed') break
        if (result.status === 'cancelled') return
        if (result.status === 'missing-material' || result.status === 'no-support') break
        await delay(BUILD_DELAY_MS * attempt)
      }

      if (result?.status === 'placed') {
        completed.add(targetKey)
        failed.delete(targetKey)
        completedCount++
        placedThisRun++
        saveState(completed, 'building')
      } else {
        failed.set(targetKey, result || { status: 'unknown' })
      }

      if (placedThisRun > 0 && placedThisRun % 25 === 0) report()
      if (buildCursor % 10 === 0) await delay(BUILD_DELAY_MS)
    }

    saveState(completed, failed.size ? 'finished-with-unresolved-blocks' : 'finished')
    report()
    if (failed.size) {
      console.warn('Some blocks could not be placed. Missing materials, unsupported blocks, and obstructions are not auto-destroyed; fix them and restart to retry.')
    } else {
      console.log('Schematic build completed.')
    }
    stopBuild()
  }

  function shutdown() {
    if (stopping) return
    stopping = true
    clearTimeout(reconnectTimer)
    stopBuild()
    saveState(completed, 'stopped')
    try { bot?.quit('Schematic builder stopped') } catch {}
    setTimeout(() => process.exit(0), 250).unref()
  }

  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
  connect()
}

main().catch(error => fail(error.message))
