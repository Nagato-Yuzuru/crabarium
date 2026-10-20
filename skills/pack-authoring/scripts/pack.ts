#!/usr/bin/env node
// The pack authoring tool: check, lint, and render a pack, add a library
// part, and trace a PNG into rows. It runs on Node 24 or later, which runs
// TypeScript directly, and it imports the mod's own pack code, so it judges
// a pack as the mod does.
//
//   node pack.ts check <pack.json>
//   node pack.ts lint <pack.json>
//   node pack.ts render <pack.json> [out.png] [--critic] [--ansi]
//   node pack.ts library
//   node pack.ts add-part <pack.json> <slot-name | part.json> [--name n] [--anchor a] [--role r]... [--replace]
//   node pack.ts trace <image.png> [--grid 16x16] [--colors 8]
//
// Exit code: 0 when the pack is fine, 1 on an error in the pack, 2 on a usage error.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { deflateSync, inflateSync } from 'node:zlib'

import { loadPack } from '../../../hooks/core/pack/load.ts'
import { compose } from '../../../hooks/core/pack/pack.ts'
import type { Pack } from '../../../hooks/core/pack/pack.ts'
import type { Rule } from '../../../hooks/core/pack/rules.ts'
import { ansiRow } from './ansi.ts'
import { LIBRARY } from './library.ts'
import { lintPack } from './lint.ts'
import { addPart, isLibraryPart } from './parts.ts'
import type { LibraryPart } from './parts.ts'
import { decodePng, encodePng } from './png.ts'
import type { Zlib } from './png.ts'
import { contactSheet, outfitFigures } from './sheet.ts'
import { trace } from './trace.ts'

const zlib: Zlib = { deflate: data => deflateSync(data), inflate: data => inflateSync(data) }

class UsageError extends Error {}

/** `--key value` options, repeatable, and the other arguments in order. */
function options(args: readonly string[], flags: readonly string[] = []): { values: Map<string, string[]>; rest: string[] } {
  const values = new Map<string, string[]>()
  const rest: string[] = []
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!
    if (!arg.startsWith('--')) rest.push(arg)
    else if (flags.includes(arg)) values.set(arg, ['true'])
    else {
      const value = args[i + 1]
      if (value === undefined) throw new UsageError(`${arg} needs a value`)
      values.set(arg, [...(values.get(arg) ?? []), value])
      i += 1
    }
  }
  return { values, rest }
}

function load(path: string | undefined): { pack: Pack; rules: readonly Rule[] } {
  if (path === undefined) throw new UsageError('name a pack.json file')
  // The mod reads pack.css next to pack.json, so the check does too.
  const cssPath = join(dirname(path), 'pack.css')
  const json = readFileSync(path, 'utf8')
  const result = loadPack(existsSync(cssPath) ? { json, css: readFileSync(cssPath, 'utf8') } : { json })
  if (result.ok) return result
  for (const error of result.errors) console.log(`error  ${error.path}: ${error.message}`)
  console.log(`${result.errors.length} error${result.errors.length === 1 ? '' : 's'}: the mod does not load this pack`)
  process.exit(1)
}

function check(args: string[]): number {
  const { pack } = load(args[0])
  console.log(`ok  ${pack.name}: a valid pack (${pack.grid.width}x${pack.grid.height}, ${Object.keys(pack.groups).length} groups)`)
  return 0
}

function lint(args: string[]): number {
  const { pack, rules } = load(args[0])
  const findings = lintPack(pack, rules)
  for (const f of findings) console.log(`${f.severity.padEnd(7)} ${f.rule}  ${f.where}: ${f.message}`)
  const errors = findings.filter(f => f.severity === 'error').length
  console.log(`${errors} errors, ${findings.length - errors} warnings`)
  return errors > 0 ? 1 : 0
}

function render(args: string[]): number {
  const flags = new Set(args.filter(a => a.startsWith('--')))
  const [path, out] = args.filter(a => !a.startsWith('--'))
  const { pack, rules } = load(path)
  if (flags.has('--ansi')) {
    const figures = outfitFigures(pack, rules)
    console.log(figures.map(f => f.label).join(' | '))
    console.log(ansiRow(figures.map(f => compose(pack, f.parts, f.pose))))
    return 0
  }
  const critic = flags.has('--critic')
  const file = out ?? join(tmpdir(), `crabarium-${pack.name}${critic ? '-critic' : ''}.png`)
  writeFileSync(file, encodePng(contactSheet(pack, { mode: critic ? 'critic' : 'inspect', rules }), zlib))
  console.log(file)
  if (critic) {
    // The key is for the author, not for the critic: it names each figure, left to right.
    console.log(
      `key: ${outfitFigures(pack, rules)
        .map((f, i) => `${i + 1}=${f.label}`)
        .join(' ')}`,
    )
  }
  return 0
}

function library(): number {
  for (const { slot, name, description, part } of LIBRARY) {
    const size = `${Math.max(...part.rows.map(r => r.length))}x${part.rows.length}`
    console.log(`${`${slot}-${name}`.padEnd(16)} ${size.padEnd(5)} anchor ${part.anchor.padEnd(6)} ${description}`)
  }
  return 0
}

function partFile(path: string): LibraryPart {
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (!isLibraryPart(value)) throw new UsageError(`${path} is not a part: it needs slot, name, description, and part`)
  return value
}

function addPartCommand(args: string[]): number {
  const { values, rest } = options(args, ['--replace'])
  const [path, source] = rest
  if (path === undefined || source === undefined) throw new UsageError('add-part <pack.json> <slot-name | part.json>')
  const part = existsSync(source) ? partFile(source) : LIBRARY.find(p => `${p.slot}-${p.name}` === source)
  if (part === undefined) throw new UsageError(`no library part ${source}; run: node pack.ts library`)
  const result = addPart(load(path).pack, part, {
    name: values.get('--name')?.[0],
    anchor: values.get('--anchor')?.[0],
    roles: values.get('--role') ?? [],
    replace: values.has('--replace'),
  })
  if (!result.ok) {
    for (const error of result.errors) console.log(`error  ${error.path}: ${error.message}`)
    return 1
  }
  writeFileSync(path, `${JSON.stringify(result.pack, null, 2)}\n`)
  console.log(`added parts.${part.slot}.${values.get('--name')?.[0] ?? part.name} to ${path}`)
  return 0
}

function traceCommand(args: string[]): number {
  const { values, rest } = options(args)
  const [path] = rest
  if (path === undefined) throw new UsageError('trace <image.png> [--grid 16x16] [--colors 8]')
  const [width, height] = (values.get('--grid')?.[0] ?? '16x16').split('x').map(Number)
  const colors = Number(values.get('--colors')?.[0] ?? 8)
  if (!Number.isInteger(width) || !Number.isInteger(height) || width! < 1 || height! < 1 || width! > 32 || height! > 32) {
    throw new UsageError('--grid is WIDTHxHEIGHT, each 1 to 32')
  }
  const image = decodePng(readFileSync(path), zlib)
  console.log(JSON.stringify(trace(image, { width: width!, height: height!, colors }), null, 2))
  return 0
}

const COMMANDS: Readonly<Record<string, (args: string[]) => number>> = {
  check,
  lint,
  render,
  library,
  'add-part': addPartCommand,
  trace: traceCommand,
}

const [command = '', ...rest] = process.argv.slice(2)
try {
  const run = COMMANDS[command]
  if (run === undefined) throw new UsageError(`commands: ${Object.keys(COMMANDS).join(', ')}`)
  process.exitCode = run(rest)
} catch (error) {
  if (!(error instanceof UsageError)) throw error
  console.error(error.message)
  process.exitCode = 2
}
