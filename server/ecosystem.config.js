// Loads .env at PM2 launch and passes vars to the app.
// Run with: pm2 start ecosystem.config.js
require('fs').readFileSync(__dirname + '/.env', 'utf8')
  .split('\n')
  .filter(l => l && !l.startsWith('#') && l.includes('='))
  .forEach(l => {
    const [k, ...v] = l.split('=');
    process.env[k.trim()] = v.join('=').trim();
  });

module.exports = {
  apps: [{
    name: 'claude-cost',
    script: 'server.js',
    cwd: __dirname,
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    max_memory_restart: '256M',
    env: {
      NODE_ENV: 'production',
      PORT: process.env.PORT || '5070',
      DB_PATH: process.env.DB_PATH || '',
      CLAUDE_COST_API_KEYS: process.env.CLAUDE_COST_API_KEYS || '',
    },
  }]
};
