import { createHash } from "node:crypto";

/**
 * A file's version is the first 12 hex characters of the SHA-256 of its bytes.
 * Any change to the content changes the version, so an agent that passes the
 * version it last read proves it is editing the file it actually saw.
 * This is optimistic locking: no lock is held between read and write.
 */
export function versionOf(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 12);
}

/**
 * Serialises async work per key (per file path) inside this process, so two
 * calls arriving at the same moment cannot both pass the version check and
 * then both write.
 */
const locks = new Map<string, Promise<void>>();

export async function withFileLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => (release = r));
  const tail = previous.then(() => mine);
  locks.set(key, tail);
  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(key) === tail) locks.delete(key);
  }
}
