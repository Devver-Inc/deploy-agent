export async function pollUntil(
  check: () => Promise<boolean>,
  timeoutMs: number,
  timeoutMessage: string,
  intervalMs = 100,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(timeoutMessage);
}
