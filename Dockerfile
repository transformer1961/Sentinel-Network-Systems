# Sentinel Bot - Docker Configuration for Railway
# Build: docker build -t sentinel-bot .
# Run: docker run -e DISCORD_TOKEN=xxx --mount type=volume,source=sentinel-data,target=/app/data sentinel-bot

FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (only production)
RUN npm ci --only=production

# Copy application code
COPY . .

# Create data directory for persistence
RUN mkdir -p /app/data

# Health check for Railway
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 3000) + '/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Expose default port (Railway will override via PORT env var)
EXPOSE 3000

# Start the bot
CMD ["node", "index.js"]
