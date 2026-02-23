import { existsSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname } from "path";
import { ensureDir } from "./fs";

export interface KeyValueRepository<T extends Record<string, unknown>> {
  get entries(): T;
  set(key: string, value: T[string]): void;
  get(key: string): T[string] | undefined;
  remove(key: string): void;
  has(key: string): boolean;
}

export class JsonRegistry<
  T extends Record<string, unknown>,
> implements KeyValueRepository<T> {
  private data: T;

  constructor(
    private filePath: string,
    private defaultValue: T,
  ) {
    this.data = this.load();
  }

  private load(): T {
    if (!existsSync(this.filePath)) return { ...this.defaultValue };
    try {
      return JSON.parse(readFileSync(this.filePath, "utf-8"));
    } catch {
      return { ...this.defaultValue };
    }
  }

  save(): void {
    ensureDir(dirname(this.filePath));
    const tmpPath = `${this.filePath}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(this.data, null, 2));
    renameSync(tmpPath, this.filePath);
  }

  get entries(): T {
    return this.data;
  }

  set(key: string, value: T[string]): void {
    (this.data as any)[key] = value;
    this.save();
  }

  get(key: string): T[string] | undefined {
    return this.data[key as keyof T] as T[string] | undefined;
  }

  remove(key: string): void {
    delete this.data[key];
    this.save();
  }

  has(key: string): boolean {
    return key in this.data;
  }
}
