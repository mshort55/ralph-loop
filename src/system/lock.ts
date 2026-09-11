import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import lockfile from "proper-lockfile";

export type ReleaseLock = () => Promise<void>;

export async function acquireRunLock(path: string): Promise<ReleaseLock> {
  await mkdir(dirname(path), { recursive: true });
  try {
    return await lockfile.lock(path, { realpath: false, retries: 0 });
  } catch {
    throw new Error("another Run already holds the lock");
  }
}
