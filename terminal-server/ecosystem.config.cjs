/**
 * PM2 Ecosystem Config for DriftSeek Terminal Server (GCP VM)
 *
 * Usage on the GCP VM:
 *   cd /path/to/drift_seek/terminal-server
 *   npm install          # installs tsx + all dependencies
 *   pm2 start ecosystem.config.cjs
 *   pm2 save
 *   pm2 startup          # enable auto-restart on reboot
 *
 * To update after a git pull:
 *   pm2 restart terminal-server
 */
module.exports = {
  apps: [
    {
      name: 'terminal-server',
      script: './node_modules/.bin/tsx',
      args: 'server.ts',
      cwd: __dirname,
      interpreter: 'node',

      // Environment — set secrets in /etc/environment or as GCP metadata instead
      env: {
        NODE_ENV: 'production',
        PORT: '3001',
        // CLIENT_ORIGINS: 'https://drift-seek.vercel.app,https://driftseek.duckdns.org',
        // TERMINAL_AUTH_TOKEN: 'your-secret',
        // GRPC_PORT: '50052',
        // SEEK_API_TOKEN: 'your-secret',
        // NEXT_PUBLIC_API_BASE_URL: 'https://drift-seek.vercel.app',
      },

      // Restart policy
      autorestart: true,
      watch: false,
      max_memory_restart: '400M',

      // Logging
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,

      // Crash recovery — wait 2s between restarts, give up after 5 consecutive crashes
      restart_delay: 2000,
      max_restarts: 5,
      min_uptime: '10s',
    },
  ],
};
