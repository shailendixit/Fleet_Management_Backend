const app = require('./app'); // <-- Use app.js here

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT} (NODE_ENV=${process.env.NODE_ENV || 'development'})`);

  // Start unified email automation in-process when configured
  // Prefer Outlook (Microsoft Graph) if OUTLOOK_* env vars are present, otherwise fall back to Gmail
  if (process.env.OUTLOOK_CLIENT_ID && process.env.OUTLOOK_CLIENT_SECRET && (process.env.OUTLOOK_TENANT_ID || process.env.OUTLOOK_REFRESH_TOKEN)) {
    try {
      const { startWatch } = require('./automation/emailautomation');
      startWatch();
      console.log('Outlook watch started (using Microsoft Graph)');
    } catch (e) {
      console.error('Failed to start Outlook watch automation:', e);
    }
  } else {
    console.log('Email watch not started. Set OUTLOOK_* or GMAIL_* OAuth env vars to enable.');
  }
});

// Graceful shutdown
function shutdown(signal) {
  console.log(`Received ${signal}. Shutting down gracefully...`);
  server.close(() => {
    console.log('HTTP server closed.');
    // allow pending Prisma clients to disconnect naturally
    process.exit(0);
  });
  // Force exit after timeout
  setTimeout(() => {
    console.error('Forcing shutdown');
    process.exit(1);
  }, 10000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));