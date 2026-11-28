FROM node:20-alpine AS builder

WORKDIR /app/grpc-worker
COPY grpc-worker/package*.json ./
RUN npm install

COPY grpc-worker/ ./
RUN npm run build

FROM node:20-alpine

WORKDIR /app/grpc-worker
COPY grpc-worker/package*.json ./
RUN npm install --omit=dev

COPY --from=builder /app/grpc-worker/dist ./dist
COPY protos/ /app/protos/

ENV NODE_ENV=production
EXPOSE 50051

CMD ["npm", "start"]
