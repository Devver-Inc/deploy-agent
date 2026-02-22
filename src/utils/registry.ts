import { existsSync, readFileSync, writeFileSync } from "fs";

export class JsonRegistry<T extends Record<string, any>> {
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
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
  }

  get entries(): T {
    return this.data;
  }

  set(key: string, value: T[string]): void {
    (this.data as any)[key] = value;
    this.save();
  }

  get(key: string): T[string] | undefined {
    return this.data[key];
  }

  remove(key: string): void {
    delete this.data[key];
    this.save();
  }

  has(key: string): boolean {
    return key in this.data;
  }
}
