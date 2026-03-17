/**
 * Polls a check function until it returns true or times out.
 * Throws an Error with the provided message on timeout.
 * Any error thrown by `check` propagates immediately without retrying.
 */
export async function pollUntil(
  check: () => Promise<boolean>,
  timeoutMs: number,
  timeoutMessage: string,
  intervalMs = 500,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(timeoutMessage);
}
