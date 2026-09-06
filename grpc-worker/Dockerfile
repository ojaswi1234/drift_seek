FROM node:20-alpine

WORKDIR /app

COPY grpc-worker/package*.json ./
RUN npm install

COPY grpc-worker/ ./grpc-worker/
COPY protos/ ./protos/

WORKDIR /app/grpc-worker
CMD ["npm", "start"]
