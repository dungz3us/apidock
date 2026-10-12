import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export interface Entity {
  id: string;
}

export interface Storage {
  list<T extends Entity>(collection: string): Promise<T[]>;
  get<T extends Entity>(collection: string, id: string): Promise<T | undefined>;
  /** Insert or replace by id. */
  put<T extends Entity>(collection: string, item: T): Promise<T>;
  delete(collection: string, id: string): Promise<boolean>;
  /** Keep only the newest `max` items (by insertion order). */
  trim(collection: string, max: number): Promise<void>;
  /** Atomically replace the whole collection. */
  replaceAll<T extends Entity>(collection: string, items: T[]): Promise<T[]>;
}

const COLLECTION_NAME = /^[a-z][a-z0-9-]{0,63}$/;

function assertCollection(name: string): void {
  if (!COLLECTION_NAME.test(name)) throw new Error(`apidock: invalid collection name "${name}"`);
}

export const newId = (): string => randomUUID();

abstract class ArrayStorage implements Storage {
  protected abstract read(collection: string): Promise<Entity[]>;
  protected abstract write(collection: string, items: Entity[]): Promise<void>;

  private queue: Promise<unknown> = Promise.resolve();

  /** Serialize read-modify-write cycles so concurrent requests never lose updates. */
  private mutate<R>(collection: string, fn: (items: Entity[]) => R | Promise<R>): Promise<R> {
    assertCollection(collection);
    const run = this.queue.then(async () => {
      const items = await this.read(collection);
      const result = await fn(items);
      await this.write(collection, items);
      return result;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  async list<T extends Entity>(collection: string): Promise<T[]> {
    assertCollection(collection);
    await this.queue;
    return (await this.read(collection)) as T[];
  }

  async get<T extends Entity>(collection: string, id: string): Promise<T | undefined> {
    return (await this.list<T>(collection)).find((i) => i.id === id);
  }

  put<T extends Entity>(collection: string, item: T): Promise<T> {
    return this.mutate(collection, (items) => {
      const idx = items.findIndex((i) => i.id === item.id);
      if (idx === -1) items.push(item);
      else items[idx] = item;
      return item;
    });
  }

  delete(collection: string, id: string): Promise<boolean> {
    return this.mutate(collection, (items) => {
      const idx = items.findIndex((i) => i.id === id);
      if (idx !== -1) items.splice(idx, 1);
      return idx !== -1;
    });
  }

  trim(collection: string, max: number): Promise<void> {
    return this.mutate(collection, (items) => {
      if (items.length > max) items.splice(0, items.length - max);
    });
  }

  replaceAll<T extends Entity>(collection: string, items: T[]): Promise<T[]> {
    return this.mutate(collection, (existing) => {
      existing.splice(0, existing.length, ...(items as Entity[]));
      return items;
    });
  }
}

export class MemoryStorage extends ArrayStorage {
  private data = new Map<string, Entity[]>();

  protected async read(collection: string): Promise<Entity[]> {
    return structuredClone(this.data.get(collection) ?? []);
  }

  protected async write(collection: string, items: Entity[]): Promise<void> {
    this.data.set(collection, structuredClone(items));
  }
}

/**
 * Stores each collection as `<dir>/<collection>.json`. Writes are atomic (temp file + rename).
 * The directory gets its own `.gitignore` so devtools data (which may contain tokens) is never committed.
 */
export class FileStorage extends ArrayStorage {
  private ready: Promise<void> | undefined;

  constructor(readonly dir: string) {
    super();
  }

  private ensureDir(): Promise<void> {
    return (this.ready ??= (async () => {
      await mkdir(this.dir, { recursive: true });
      const gitignore = join(this.dir, '.gitignore');
      if (!existsSync(gitignore)) await writeFile(gitignore, '*\n');
    })());
  }

  protected async read(collection: string): Promise<Entity[]> {
    await this.ensureDir();
    try {
      return JSON.parse(await readFile(join(this.dir, `${collection}.json`), 'utf8')) as Entity[];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  }

  protected async write(collection: string, items: Entity[]): Promise<void> {
    await this.ensureDir();
    const file = join(this.dir, `${collection}.json`);
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, JSON.stringify(items, null, 2));
    await rename(tmp, file);
  }
}
