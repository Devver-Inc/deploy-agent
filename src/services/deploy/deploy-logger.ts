export class DeployLogger {
  log(
    level: "info" | "error",
    event: string,
    data: Record<string, unknown>,
  ): void {
    const payload = {
      timestamp: new Date().toISOString(),
      component: "deploy-agent",
      event,
      level,
      ...data,
    };

    const line = JSON.stringify(payload);
    if (level === "error") {
      console.error(line);
      return;
    }
    console.log(line);
  }
}
