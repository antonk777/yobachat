export default {
  apps: [
    {
      name: 'yobachat-server',
      script: 'dist/index.js',
      cwd: './server',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      env: {
        NODE_ENV: 'production'
      },
      error_file: '../logs/server-error.log',
      out_file: '../logs/server-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      min_uptime: '10s'
    }
  ]
};
