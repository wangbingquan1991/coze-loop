import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packagedComposeDir = join(packageRoot, 'release', 'deployment', 'docker-compose')

export const name = 'dsh-coze-loop'
export const inject = ['commands']

const DEFAULTS = Object.freeze({
  autoStart: true,
  pullOnStart: false,
  stopOnDispose: false,
  webPort: 8082,
  dockerBin: 'docker',
  commandTimeoutMs: 15 * 60 * 1000,
  logTail: 80,
})

function mergeConfig(config = {}) {
  return { ...DEFAULTS, ...config }
}

function getDshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

function getRuntimeDir(config) {
  const value = typeof config.runtimeDir === 'string' ? config.runtimeDir.trim() : ''
  return value ? resolve(value) : join(getDshHome(), 'apps', 'coze-loop')
}

function getWebUrl(config) {
  const host = typeof config.webHost === 'string' && config.webHost.trim()
    ? config.webHost.trim()
    : '127.0.0.1'
  return 'http://' + host + ':' + (Number(config.webPort) || DEFAULTS.webPort)
}

function normalizeError(error) {
  const stderr = typeof error?.stderr === 'string' ? error.stderr.trim() : ''
  const stdout = typeof error?.stdout === 'string' ? error.stdout.trim() : ''
  const message = error instanceof Error ? error.message : String(error)
  return stderr || stdout || message
}

async function copyRuntimeAssets(runtimeDir) {
  if (!existsSync(packagedComposeDir)) {
    throw new Error('Packaged Coze Loop Compose assets are missing: ' + packagedComposeDir)
  }

  await mkdir(runtimeDir, { recursive: true })

  const composeFile = join(runtimeDir, 'docker-compose.yml')
  if (!existsSync(composeFile)) {
    await cp(packagedComposeDir, runtimeDir, {
      recursive: true,
      force: false,
      errorOnExist: false,
    })
  }

  const envFile = join(runtimeDir, '.env')
  if (!existsSync(envFile)) {
    const packagedEnv = join(packagedComposeDir, '.env')
    if (!existsSync(packagedEnv)) {
      throw new Error('Packaged Coze Loop .env file is missing.')
    }
    await cp(packagedEnv, envFile, { force: false })
  }

  return { runtimeDir, composeFile, envFile }
}

function createManager(rawConfig = {}) {
  const config = mergeConfig(rawConfig)
  const runtimeDir = getRuntimeDir(config)

  async function runDocker(args, options = {}) {
    const result = await execFileAsync(config.dockerBin, args, {
      cwd: options.cwd || runtimeDir,
      timeout: config.commandTimeoutMs,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
      env: process.env,
    })

    return {
      stdout: result.stdout?.trim() || '',
      stderr: result.stderr?.trim() || '',
    }
  }

  async function ensureReady() {
    const assets = await copyRuntimeAssets(runtimeDir)

    await runDocker(['version', '--format', '{{.Server.Version}}'], {
      cwd: assets.runtimeDir,
    })
    await runDocker(['compose', 'version'], {
      cwd: assets.runtimeDir,
    })

    return assets
  }

  async function compose(extraArgs) {
    const assets = await ensureReady()
    return runDocker([
      'compose',
      '-f',
      assets.composeFile,
      '--env-file',
      assets.envFile,
      '--profile',
      '*',
      ...extraArgs,
    ], {
      cwd: assets.runtimeDir,
    })
  }

  async function status() {
    const result = await compose(['ps', '--all'])
    const output = result.stdout || result.stderr || 'No Compose status output.'
    return output + '\\n\\nWeb: ' + getWebUrl(config) + '\\nRuntime: ' + runtimeDir
  }

  async function start(options = {}) {
    const shouldPull = options.pull ?? Boolean(config.pullOnStart)
    if (shouldPull) await compose(['pull'])
    await compose(['up', '-d'])
    return status()
  }

  async function stop() {
    const result = await compose(['down'])
    return result.stdout || result.stderr || 'Coze Loop stopped.'
  }

  async function restart() {
    await stop()
    return start({ pull: false })
  }

  async function update() {
    await compose(['pull'])
    await compose(['up', '-d'])
    return status()
  }

  async function logs(service) {
    const tail = Math.max(1, Number(config.logTail) || DEFAULTS.logTail)
    const args = ['logs', '--no-color', '--tail', String(tail)]
    if (service) args.push(service)
    const result = await compose(args)
    return result.stdout || result.stderr || 'No logs.'
  }

  return {
    config,
    runtimeDir,
    webUrl: getWebUrl(config),
    start,
    stop,
    restart,
    update,
    status,
    logs,
  }
}

function commandResult(task) {
  return async () => {
    try {
      const output = await task()
      return { kind: 'success', text: output }
    } catch (error) {
      return {
        kind: 'error',
        text: 'Coze Loop operation failed: ' + normalizeError(error),
      }
    }
  }
}

export function apply(ctx, rawConfig = {}) {
  const manager = createManager(rawConfig)
  const disposers = []

  const register = (definition) => {
    const disposer = ctx.commands.register(definition)
    if (typeof disposer === 'function') disposers.push(disposer)
  }

  register({
    name: 'cozeloop-status',
    description: 'Show Coze Loop Docker Compose status and access URL.',
    handler: commandResult(() => manager.status()),
  })

  register({
    name: 'cozeloop-start',
    description: 'Start Coze Loop in Docker Compose.',
    handler: commandResult(() => manager.start({ pull: false })),
  })

  register({
    name: 'cozeloop-stop',
    description: 'Stop Coze Loop without deleting persistent volumes.',
    handler: commandResult(() => manager.stop()),
  })

  register({
    name: 'cozeloop-restart',
    description: 'Restart Coze Loop without deleting persistent volumes.',
    handler: commandResult(() => manager.restart()),
  })

  register({
    name: 'cozeloop-update',
    description: 'Pull the configured Coze Loop images and apply them.',
    handler: commandResult(() => manager.update()),
  })

  register({
    name: 'cozeloop-logs',
    description: 'Show recent Coze Loop logs. Optional input: service name.',
    input: { hint: 'optional service name, e.g. app or nginx' },
    handler: async ({ rawInput = '' }) => {
      try {
        const service = String(rawInput).trim().split(/\\s+/)[0] || ''
        const output = await manager.logs(service)
        return { kind: 'success', text: output }
      } catch (error) {
        return {
          kind: 'error',
          text: 'Coze Loop logs failed: ' + normalizeError(error),
        }
      }
    },
  })

  register({
    name: 'cozeloop-open',
    description: 'Show the local Coze Loop web URL.',
    handler: commandResult(async () => manager.webUrl),
  })

  if (manager.config.autoStart) {
    queueMicrotask(() => {
      manager.start().catch((error) => {
        console.error('[dsh-coze-loop] automatic start failed:', normalizeError(error))
      })
    })
  }

  if (typeof ctx.on === 'function') {
    ctx.on('dispose', () => {
      for (const dispose of disposers.splice(0)) {
        try {
          dispose()
        } catch {
          // Cordis may already have disposed this contribution.
        }
      }

      if (manager.config.stopOnDispose) {
        manager.stop().catch((error) => {
          console.error('[dsh-coze-loop] stop-on-dispose failed:', normalizeError(error))
        })
      }
    })
  }
}
