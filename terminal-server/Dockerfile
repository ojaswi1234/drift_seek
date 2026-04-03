# Runtime image for the terminal server
FROM node:20-alpine

WORKDIR /terminal-server

RUN apk add --no-cache docker-cli python3 make g++ linux-headers

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# Set environment variables (These are what Dockerode will 'peek' at)
ENV NODE_ENV=production
ENV PORT=3001

# Expose the port the app runs on
EXPOSE 3001

# Start the application
CMD ["npm", "start"]