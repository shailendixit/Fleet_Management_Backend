const { PrismaClient } = require('../generated/prisma');

// Use a global variable to ensure a single PrismaClient instance in development
if (!global.__prisma) {
  global.__prisma = new PrismaClient();
}

module.exports = global.__prisma;
