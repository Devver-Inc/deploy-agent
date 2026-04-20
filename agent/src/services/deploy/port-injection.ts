const NODE_PORT_FLAGS = ["--port", "-p", "--port=", "-p="];
const NODE_HOST_FLAGS = ["--host", "-H", "--host=", "-H="];

export function injectPort(
  argv: readonly string[],
  port: number,
  bin: string,
): readonly string[] {
  if (bin === "bun" || bin === "node" || bin === "npm" || bin === "pnpm" || bin === "yarn") {
    const hasPort = argv.some(arg =>
      NODE_PORT_FLAGS.some(flag => arg === flag || arg.startsWith(flag))
    );

    const hasHost = argv.some(arg =>
      NODE_HOST_FLAGS.some(flag => arg === flag || arg.startsWith(flag))
    );

    const newArgv = [...argv];

    if (!hasHost) {
      newArgv.push("--host", "0.0.0.0");
    }

    if (!hasPort) {
      newArgv.push("--port", String(port));
    }

    return newArgv;
  }

  return argv;
}