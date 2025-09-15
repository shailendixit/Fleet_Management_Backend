FROM node:18-bullseye-slim

WORKDIR /usr/src/app

# Copy package manifests first to take advantage of Docker layer caching
COPY package*.json ./

# Install production dependencies
RUN npm ci --only=production

# Copy rest of the app
COPY . .

# Generate Prisma client for the runtime (will download correct query engine)
RUN npx prisma generate --schema=prisma/schema.prisma || true

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "src/server.js"]
