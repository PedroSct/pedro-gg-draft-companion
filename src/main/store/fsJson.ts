// src/main/store/fsJson.ts
import { promises as fs } from 'node:fs'
import path from 'node:path'

/** Lê JSON; qualquer falha (inexistente, corrompido) vira null. */
export async function readJson<T = unknown>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T
  } catch {
    return null
  }
}

const RETRYABLE = new Set(['EPERM', 'EBUSY', 'EACCES'])

/**
 * Grava em arquivo temporário e renomeia: um crash ou queda de energia nunca
 * deixa o JSON pela metade. No Windows o antivírus às vezes segura o arquivo por
 * alguns ms, então o rename tem algumas tentativas.
 */
export async function writeJsonAtomic(file: string, data: unknown, pretty = false): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  await fs.writeFile(tmp, JSON.stringify(data, null, pretty ? 2 : undefined), 'utf8')
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(tmp, file)
      return
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? ''
      if (attempt >= 4 || !RETRYABLE.has(code)) {
        await fs.rm(tmp, { force: true })
        throw err
      }
      await new Promise((r) => setTimeout(r, 60 * (attempt + 1)))
    }
  }
}
