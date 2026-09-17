import { readFile, writeFile, access } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
const root = fileURLToPath(new URL('..', import.meta.url))
process.chdir(root)
if (Number(process.versions.node.split('.')[0]) < 24) {
  console.error('Нужен Node.js 24 LTS или новее. Скачать: https://nodejs.org/en/download')
  process.exit(1)
}
try {
  process.loadEnvFile(path.join(root, '.env'))
} catch (e) {
  if (e.code !== 'ENOENT') throw e
}
const hash = createHash('sha256')
  .update(await readFile('package-lock.json'))
  .digest('hex')
let install = false
try {
  install = (await readFile('node_modules/.life-lock', 'utf8')) !== hash
  await access('node_modules/tsx/package.json')
} catch {
  install = true
}
function run(command, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(command, args, { cwd: root, stdio: 'inherit' })
    p.once('error', reject)
    p.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`Команда завершилась с кодом ${code}.`))
    )
  })
}
try {
  if (install) {
    console.log('Первый запуск: устанавливаю зафиксированные зависимости…')
    await run('npm', ['ci', '--include=dev', '--ignore-scripts', '--no-audit', '--no-fund'])
    await writeFile('node_modules/.life-lock', hash)
  }
  const args = [
    '--import',
    'tsx',
    'server/index.ts',
    ...(process.argv.includes('--built') ? ['--built'] : [])
  ]
  const child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit' })
  child.once('error', (e) => {
    console.error(e.message)
    process.exitCode = 1
  })
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal))
  child.once('exit', (code) => {
    process.exitCode = code ?? 0
  })
} catch (error) {
  console.error(
    'Запуск остановлен:',
    error.message,
    '\nПри установке зависимостей нужен интернет. Повторный запуск продолжит установку.'
  )
  process.exitCode = 1
}
