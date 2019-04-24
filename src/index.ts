import fs from 'fs'
import path from 'path'
import minimist from 'minimist'
import mapValues from 'lodash.mapvalues'
import camelCase from 'lodash.camelcase'

const transformKey = (transformer: (key: string) => string) => (obj: any) => {
  const ret = {} as any
  for (const [k, v] of Object.entries(obj)) {
    ret[transformer(k)] = v
  }
  return ret
}

const camelCaseObject = transformKey(camelCase)

function checkForExtra({ config, json, args, env, merged }: any) {
  for (const key of Object.keys(merged)) {
    if (!(key in config)) {
      if (key in json) {
        throw new Error(`Found unknown option ${key} in ${env}.json`)
      } else if (key in args) {
        throw new Error(`Found unknown switch ${key}`)
      } else {
        throw new Error(
          `Found unknown option ${key} but I have no idea where it came from`,
        )
      }
    }
  }
}

function checkOptions({
  config,
  merged,
  skipDollars,
}: {
  config: any
  merged: any
  skipDollars: boolean
}) {
  for (const key of Object.keys(config)) {
    const value = merged[key]
    if (skipDollars && value.startsWith('$')) continue
    if (!(key in merged)) throw new Error(`Missing option ${key}`)
    if (config[key] === 'string[]') {
      // is not array or something is string
      if (!Array.isArray(value) || value.some(v => typeof v !== 'string')) {
        throw new Error(`Value of option ${key} should be array of strings`)
      }
    } else if (config[key] === 'string') {
      if (typeof value !== 'string')
        throw new Error(`Value of option ${key} should be string`)
    } else if (config[key] === 'number') {
      if (typeof value !== 'number')
        throw new Error(`Value of option ${key} should be number got ${value}`)
    } else if (config[key] === 'boolean') {
      if (typeof value !== 'boolean')
        throw new Error(`Value of option ${key} should be boolean`)
    } else if (config[key] === 'string|false') {
      if (typeof value !== 'string' && value !== false)
        throw new Error(`Value of option ${key} should be string or false`)
    } else {
      throw new Error(`Unknown config type ${config[key]} specified for ${key}`)
    }
  }
}

function coerce(config: any, merged: any) {
  return mapValues(merged, (value, key) => {
    if (config[key] === 'string[]') {
      if (!Array.isArray(value) && typeof value === 'string') return [value]
    } else if (config[key] === 'string') {
      if (['number', 'boolean'].includes(config[key])) {
        return `${value}`
      }
    } else if (config[key] === 'number') {
      const v = Number.parseFloat(value)
      if (Number.isFinite(v)) return v
    } else if (config[key] === 'boolean') {
      if (value === 'true') return true
      if (value === 'false') return false
    }

    return value
  })
}

function rewriteDolarsFromEnv(merged: any) {
  const ret = { ...merged }
  for (const [key, value] of Object.entries(merged)) {
    if (typeof value === 'string' && /^\$[a-zA-Z0-9_]+$/.exec(value)) {
      ret[key] = process.env[value.substring(1)]
    } else if (typeof value === 'string' && /^\\\$/.exec(value)) {
      ret[key] = merged[key].substring(1)
    }
  }
  return ret
}

// ponyfill for Object.fromEntries
const fromEntries = (iterable: any) => {
  return [...iterable].reduce(
    (obj, { 0: key, 1: val }) => Object.assign(obj, { [key]: val }),
    {},
  )
}

const settingsParser = <E extends {}>({
  configDir,
  envs,
  defaultEnv,
  argv = process.argv.slice(2),
}: {
  configDir: string
  envs: E[]
  defaultEnv: E
  argv?: string[]
}) => <
  T extends {
    [key: string]: 'string' | 'number' | 'boolean' | 'string[]' | 'string|false'
  }
>(
  config: T,
): {
  env: E
  settings: {
    [key in keyof T]: T[key] extends 'string'
      ? string
      : T[key] extends 'number'
      ? number
      : T[key] extends 'boolean'
      ? boolean
      : T[key] extends 'string[]'
      ? string[]
      : T[key] extends 'string|false'
      ? string | false
      : never
  }
} => {
  // load
  const rawEnv = process.env.NODE_ENV || ''
  const env = envs.includes(rawEnv as any) ? ((rawEnv as any) as E) : defaultEnv

  const settingMap = new Map<E, any>()
  for (const currentEnv of env === defaultEnv ? envs : [env]) {
    const jsonRaw = JSON.parse(
      fs.readFileSync(path.join(configDir, `${currentEnv}.json`), 'utf-8'),
    )
    function isComment(key: string, value: any) {
      return key.startsWith('#') && value === ''
    }
    const json = fromEntries(
      Object.entries(jsonRaw).filter(([key, value]) => !isComment(key, value)),
    )
    const args = camelCaseObject(minimist(argv))
    delete args['']

    let merged = { ...json, ...args }

    // check and transform
    checkForExtra({ config, json, args, env: currentEnv, merged })
    merged = currentEnv === env ? rewriteDolarsFromEnv(merged) : merged
    merged = coerce(config, merged)
    checkOptions({ config, merged, skipDollars: currentEnv !== env })
    settingMap.set(currentEnv, merged)
  }

  return { env, settings: settingMap.get(env) }
}
export default settingsParser
