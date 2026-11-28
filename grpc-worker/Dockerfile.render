# Render Dockerfile for gRPC worker (Build context: grpc-worker)
FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

FROM node:20-alpine

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist
COPY protos ./protos

ENV NODE_ENV=production
EXPOSE 50051
EXPOSE 8080

CMD ["npm", "start"]
