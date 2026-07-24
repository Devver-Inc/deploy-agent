import { describe, expect, it } from "bun:test";
import { KeyedAsyncMutex } from "./async-mutex";

describe("KeyedAsyncMutex", () => {
  it("serializes work for the same deployment", async () => {
    const mutex = new KeyedAsyncMutex();
    const events: string[] = [];
    let releaseFirst = () => {};
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = mutex.run("deployment", async () => {
      events.push("first:start");
      await firstGate;
      events.push("first:end");
    });

    await Promise.resolve();

    const second = mutex.run("deployment", async () => {
      events.push("second:start");
      events.push("second:end");
    });

    await Promise.resolve();
    expect(events).toEqual(["first:start"]);

    releaseFirst();
    await Promise.all([first, second]);

    expect(events).toEqual([
      "first:start",
      "first:end",
      "second:start",
      "second:end",
    ]);
  });
});
