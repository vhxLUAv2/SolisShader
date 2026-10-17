'use strict'

const mineflayer = require('@wp2508/mineflayer')

function readInteger(name, fallback, minimum, maximum) {
  const raw = process.env[name]
  if (raw == null || raw.trim() === '') return fallback

  const value = Number(raw)
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`)
  }
  return value
}

const config = {
  host: (process.env.MC_HOST || '127.0.0.1').trim(),
  port: readInteger('MC_PORT', 25565, 1, 65535),
  username: (process.env.MC_USERNAME || 'SolisAFKBot').trim(),
  version: (process.env.MC_VERSION || '26.3').trim(),
  jumpMinMs: readInteger('JUMP_MIN_SECONDS', 20, 1, 3600) * 1000,
  jumpMaxMs: readInteger('JUMP_MAX_SECONDS', 28, 1, 3600) * 1000,
  reconnectDelayMs: readInteger('RECONNECT_DELAY_SECONDS', 10, 1, 3600) * 1000
}

if (!config.host) throw new Error('MC_HOST must not be empty.')
if (!/^[A-Za-z0-9_]{3,16}$/.test(config.username)) {
  throw new Error('MC_USERNAME must contain 3–16 letters, numbers, or underscores.')
}
if (!config.version) throw new Error('MC_VERSION must not be empty.')
if (config.jumpMinMs > config.jumpMaxMs) {
  throw new Error('JUMP_MIN_SECONDS must be less than or equal to JUMP_MAX_SECONDS.')
}

let activeBot = null
let reconnectTimer = null
let jumpTimer = null
let jumpReleaseTimer = null
let shuttingDown = false

function clearJumpTimers() {
  clearTimeout(jumpTimer)
  clearTimeout(jumpReleaseTimer)
  jumpTimer = null
  jumpReleaseTimer = null
}

function randomJumpDelay() {
  return config.jumpMinMs + Math.floor(Math.random() * (config.jumpMaxMs - config.jumpMinMs + 1))
}

function scheduleJump(bot) {
  if (shuttingDown || activeBot !== bot) return

  clearTimeout(jumpTimer)
  jumpTimer = setTimeout(() => {
    jumpTimer = null
    if (shuttingDown || activeBot !== bot || bot.ended) return

    if (!bot.entity || !bot.entity.onGround) {
      scheduleJump(bot)
      return
    }

    bot.setControlState('jump', true)
    jumpReleaseTimer = setTimeout(() => {
      jumpReleaseTimer = null
      if (!shuttingDown && activeBot === bot && !bot.ended) {
        bot.setControlState('jump', false)
      }
      if (!shuttingDown && activeBot === bot) scheduleJump(bot)
    }, 140)
  }, randomJumpDelay())
}

function describeReason(reason) {
  if (reason == null) return 'no reason supplied'
  if (typeof reason === 'string') return reason
  try {
    return JSON.stringify(reason)
  } catch {
    return String(reason)
  }
}

function scheduleReconnect() {
  if (shuttingDown || reconnectTimer) return

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connect()
  }, config.reconnectDelayMs)
}

function connect() {
  if (shuttingDown || activeBot) return

  console.log(`Connecting to ${config.host}:${config.port} as ${config.username} (Minecraft ${config.version})...`)

  let bot
  try {
    bot = mineflayer.createBot({
      host: config.host,
      port: config.port,
      username: config.username,
      auth: 'offline',
      version: config.version
    })
  } catch (error) {
    console.error('Could not start the connection:', error.message)
    scheduleReconnect()
    return
  }

  activeBot = bot

  bot.once('spawn', () => {
    console.log('Connected. Periodic jumping is active.')
    scheduleJump(bot)
  })

  bot.on('kicked', reason => {
    console.warn('Server disconnected the bot:', describeReason(reason))
  })

  bot.on('error', error => {
    console.error('Connection error:', error.message || describeReason(error))
  })

  bot.on('end', reason => {
    clearJumpTimers()
    if (activeBot === bot) activeBot = null
    console.warn(`Disconnected: ${describeReason(reason)}`)
    scheduleReconnect()
  })
}

function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  clearJumpTimers()
  clearTimeout(reconnectTimer)
  reconnectTimer = null

  const bot = activeBot
  activeBot = null

  if (bot) {
    try {
      bot.clearControlStates()
      bot.quit('Bot stopped')
    } catch (error) {
      console.error('Error while stopping:', error.message)
    }
  }

  console.log('AFK bot stopped.')
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)

connect()
