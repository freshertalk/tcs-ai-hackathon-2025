// pm2 process file for the VPS: one Node process serves the built site, the API and the
// private area (/me).   pm2 start deploy/ecosystem.config.cjs   ·   pm2 save
//
// Change PORT if something else on the server already uses it, and keep nginx's
// proxy_pass (deploy/nginx.conf.example) on the same port.
//
// Staying up (README → "Staying up"): pm2 restarts the process whenever it exits (a crash makes it
// exit on purpose — server/lifecycle.js) or grows past max_memory_restart, waiting a little longer
// each time it keeps failing; systemd starts pm2 (and this app) again after a reboot
// (pm2 startup + pm2 save); deploy/watchdog.sh restarts it when it is up but no longer answers.
module.exports = {
  apps: [
    {
      name: "vinaytiwari",
      cwd: __dirname + "/..",
      script: "server/index.js",
      instances: 1, // one process: the trading guard rails and the live stream live in its memory
      exec_mode: "fork",

      // restarts
      autorestart: true,
      // a leak cannot take the machine down: restart past 1 GB. It was 600 MB until 21 Nov 2026, when the app's normal
      // working set (the records, the live desk) plus the forecaster's training on the stored year crossed it: pm2
      // restarted the app every minute and nginx answered 502 meanwhile. The heap cap below makes Node collect garbage
      // before it nears the line, so only a real leak reaches it.
      max_memory_restart: "1G",
      node_args: "--max-old-space-size=800",
      exp_backoff_restart_delay: 200, // a crash loop backs off: 200 ms, 300, 450 … up to 15 s, reset after 30 s up
      min_uptime: "30s", // a start that dies within 30 s counts as unstable…
      max_restarts: 15, // …and after 15 unstable starts in a row pm2 gives up (the watchdog then tries again)

      // starting and stopping
      wait_ready: true, // up only when the server says so (process.send("ready") once it listens)
      listen_timeout: 20000, // …or after 20 s at the latest
      kill_timeout: 10000, // a stop or restart waits up to 10 s for the clean close (the app hard-exits at 8 s)

      // logs: one file per stream, every line time-stamped (rotation: pm2 install pm2-logrotate)
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",

      env: {
        NODE_ENV: "production",
        PORT: "5100",
        HOST: "127.0.0.1", // reachable only through nginx
        PUBLIC_ORIGIN: "https://vinaytiwari.org",
        TRUST_PROXY: "1", // nginx sits in front: trust its X-Forwarded-* headers
      },
    },
  ],
};
