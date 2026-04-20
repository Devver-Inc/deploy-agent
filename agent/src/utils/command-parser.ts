import { DeployError } from "./errors";

export const ALLOWED_BINARIES = ["bun", "node", "npm", "pnpm", "yarn", "python", "python3", "uv"] as const;

export type AllowedBinary = typeof ALLOWED_BINARIES[number];

export interface ParsedCommand {
  bin: AllowedBinary;
  argv: readonly string[];
  raw: string;
}

const METACHAR_PATTERN = /[&|;`$()[\]{}<>\r\n!#*?~]/;
const QUOTE_PAIRS = { '"': '"', "'": "'" };
const WORD_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: string | null = null;
  let escaped = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === "\\" && !quote) {
      escaped = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char in QUOTE_PAIRS) {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current) {
    tokens.push(current);
  }

  if (escaped) {
    throw DeployError.validation("Trailing backslash in command");
  }

  return tokens;
}

export function parseCommand(input: string): ParsedCommand {
  const trimmed = input.trim();

  if (!trimmed) {
    throw DeployError.validation("Command cannot be empty");
  }

  if (METACHAR_PATTERN.test(trimmed)) {
    const found = trimmed.match(METACHAR_PATTERN)?.[0];
    throw DeployError.validation(
      `Command contains disallowed metacharacter: ${found}`,
      { metacharacter: found }
    );
  }

  const tokens = tokenize(trimmed);

  if (tokens.length === 0) {
    throw DeployError.validation("Command cannot be empty");
  }

  const bin = tokens[0].toLowerCase();

  if (!WORD_PATTERN.test(bin)) {
    throw DeployError.validation(
      `Binary name contains invalid characters`,
      { binary: bin }
    );
  }

  const normalizedBin = bin === "nodejs" ? "node" : bin;

  if (!ALLOWED_BINARIES.includes(normalizedBin as AllowedBinary)) {
    throw DeployError.validation(
      `Binary '${bin}' is not allowed. Allowed: ${ALLOWED_BINARIES.join(", ")}`,
      { binary: bin, allowed: ALLOWED_BINARIES }
    );
  }

  const argv = tokens.slice(1);

  return {
    bin: normalizedBin as AllowedBinary,
    argv,
    raw: input,
  };
}

export function isAllowedBinary(bin: string): bin is AllowedBinary {
  return ALLOWED_BINARIES.includes(bin as AllowedBinary);
}