import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'

test('server watch reloads changed TypeScript dependencies automatically', { timeout: 15000 }, async () => {
  const directory = await mkdtemp(path.join(process.cwd(), '.watch-test-'))
  const entry = path.join(directory, 'index.ts')
  const dependency = path.join(directory, 'version.ts')
  await writeFile(dependency, "export const version = 'first'\n")
  await writeFile(entry, "import { version } from './version.js'\nconsole.log('READY:' + version)\nsetInterval(() => {}, 1000)\n")
  const child = spawn(process.execPath, ['--watch', '--watch-preserve-output', '--import', 'tsx', entry], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', (chunk) => { output += chunk })
  child.stderr.on('data', (chunk) => { output += chunk })
  const waitFor = (value: string) => new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => { clearInterval(poll); reject(new Error(output)) }, 6000)
    const poll = setInterval(() => {
      if (output.includes(value)) { clearTimeout(timeout); clearInterval(poll); resolve() }
    }, 30)
  })
  try {
    await waitFor('READY:first')
    await writeFile(dependency, "export const version = 'updated'\n")
    await waitFor('READY:updated')
    assert.ok(output.includes('READY:first') && output.includes('READY:updated'))
  } finally {
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
    child.kill('SIGTERM')
    await exited
    await rm(directory, { recursive: true, force: true })
  }
})
