// pm2 process file: keeps the server AND the ngrok tunnel running, restarts them if they crash.
//   npm run build && pm2 start ecosystem.config.cjs && pm2 save
try {
  process.loadEnvFile(".env"); // Node 20.12+: read PORT, NGROK_DOMAIN and NGROK_PATH from .env
} catch {
  /* no .env yet */
}
const port = process.env.PORT || "8787";
const domain = process.env.NGROK_DOMAIN;
// On Windows pm2 often cannot find "ngrok" on PATH. Set NGROK_PATH in .env to the full path of ngrok.exe.
const ngrok = process.env.NGROK_PATH || "ngrok";

module.exports = {
  apps: [
    {
      name: "mcp-file-server",
      script: "dist/server.js",
      node_args: "--env-file=.env",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000,
      out_file: "logs/pm2-out.log",
      error_file: "logs/pm2-error.log",
      time: true,
    },
    {
      name: "mcp-tunnel",
      script: ngrok,
      args: domain ? `http --url=${domain} ${port}` : `http ${port}`,
      interpreter: "none",
      autorestart: true,
      restart_delay: 5000,
    },
  ],
};
