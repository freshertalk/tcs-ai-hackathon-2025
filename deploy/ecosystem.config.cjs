// pm2 process file for the VPS: one Node process serves the built site, the API and the
// private area (/me).   pm2 start deploy/ecosystem.config.cjs   ·   pm2 save
//
// Change PORT if something else on the server already uses it, and keep nginx's
// proxy_pass (deploy/nginx.conf.example) on the same port.
module.exports = {
  apps: [
    {
      name: "vinaytiwari",
      cwd: __dirname + "/..",
      script: "server/index.js",
      instances: 1, // one process: the trading guard rails and the live stream live in its memory
      exec_mode: "fork",
      max_memory_restart: "600M",
      env: {
        NODE_ENV: "production",
        PORT: "5100",
        PUBLIC_ORIGIN: "https://vinaytiwari.org",
        TRUST_PROXY: "1", // nginx sits in front: trust its X-Forwarded-* headers
      },
    },
  ],
};
