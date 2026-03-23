import { LogEntryLevel, type LogEntry } from "../../types";

const ISO_TIMESTAMP_RE =
  /\b(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)\b/;
const DATE_TIME_RE = /\b(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\b/;

function extractTimestamp(line: string): string {
  const iso = ISO_TIMESTAMP_RE.exec(line);
  if (iso) return new Date(iso[1]!).toISOString();
  const dt = DATE_TIME_RE.exec(line);
  if (dt) return new Date(dt[1]!).toISOString();
  return new Date().toISOString();
}

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
        timestamp: extractTimestamp(line),
      };
    });
}
