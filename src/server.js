const app = require('./app'); // <-- Use app.js here

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT} (NODE_ENV=${process.env.NODE_ENV || 'development'})`);

  // Start unified email automation in-process when configured
  // Prefer Gmail API watch if OAuth credentials are present
  if (process.env.GMAIL_OAUTH_CLIENT_ID && process.env.GMAIL_OAUTH_CLIENT_SECRET && process.env.GMAIL_OAUTH_REFRESH_TOKEN) {
    try {
      const { startWatch } = require('./automation/emailautomation');
      startWatch();
      console.log('Gmail watch started (using Gmail API + Pub/Sub)');
    } catch (e) {
      console.error('Failed to start Gmail watch automation:', e);
    }
  } else {
    console.log('GMAIL OAuth credentials not set; Gmail watch not started. Set GMAIL_OAUTH_CLIENT_ID / CLIENT_SECRET / REFRESH_TOKEN and PUBSUB_TOPIC_NAME to enable.');
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