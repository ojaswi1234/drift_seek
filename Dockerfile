# Stage 1: Build the application
FROM node:20-alpine AS builder

# Set the working directory inside the container
WORKDIR /app

RUN apk add --no-cache python3 make g++ linux-headers
COPY package*.json ./
RUN npm install

# Copy the rest of your application code
COPY . .

# Build the project (e.g., Next.js build)
RUN npm run build

# Stage 2: Run the application
FROM node:20-alpine AS runner

WORKDIR /app

# FIX: Install Python and build tools so node-pty can compile in the runner stage
RUN apk add --no-cache python3 make g++ linux-headers

# Copy only the necessary files from the builder stage
COPY --from=builder /app/next.config.ts ./
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/package.json ./
COPY --from=builder /app/package-lock.json ./

# The node-pty module will now compile successfully
RUN npm ci --omit=dev

# Set environment variables (These are what Dockerode will 'peek' at)
ENV NODE_ENV=production
ENV PORT=3000

# Expose the port the app runs on
EXPOSE 3000

# Start the application
CMD ["npm", "start"]