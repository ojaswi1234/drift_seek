# Metrics Collector for Blackbox Exporter
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm install --omit=dev

# Copy application code
COPY index.js ./

# Set environment variables
ENV NODE_ENV=production
ENV PORT=9116

# Expose the API port
EXPOSE 9116

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:9116/health || exit 1

# Start the application
CMD ["npm", "start"]