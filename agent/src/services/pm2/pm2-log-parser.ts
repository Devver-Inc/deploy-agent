import { LogEntryLevel, type LogEntry } from "../../types";

export function parsePm2Logs(
  deploymentId: string,
  processName: string,
  raw: string,
): LogEntry[] {
  const service = processName.split(`-${deploymentId}-`)[0];

  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const lower = line.toLowerCase();
      return {
        service,
        level:
          lower.includes("error") ||
          lower.includes("exception") ||
          lower.includes("fatal")
            ? LogEntryLevel.ERROR
            : LogEntryLevel.INFO,
        message: line,
        timestamp: new Date().toISOString(),
      };
    });
}
