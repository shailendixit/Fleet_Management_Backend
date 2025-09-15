const app = require('./app'); // <-- Use app.js here

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT} (NODE_ENV=${process.env.NODE_ENV || 'development'})`);

  // Start unified email automation in-process when configured
  if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
    try {
      const { startListening: startEmailAutomation } = require('./automation/emailautomation');
      startEmailAutomation();
      console.log('Unified email automation started');
    } catch (e) {
      console.error('Failed to start unified email automation:', e);
    }
  } else {
    console.log('GMAIL credentials not set; automation not started');
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