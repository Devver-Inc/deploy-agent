const agent = require("fs").existsSync("/usr/local/bin/deploy-agent")
  ? { script: "/usr/local/bin/deploy-agent" }
  : { script: "/usr/local/bin/bun", args: "run src/index.ts", cwd: "/app/agent" };

// Absolute paths: PM2 resolves a bare name against the cwd first (/app/nginx is a directory).
module.exports = {
  apps: [
    { name: "nginx", script: "/usr/sbin/nginx", interpreter: "none", autorestart: true },
    { name: "sshd", script: "/usr/sbin/sshd", args: "-D -e", interpreter: "none", autorestart: true },
    { name: "agent", interpreter: "none", autorestart: true, restart_delay: 2000, ...agent },
  ],
};
