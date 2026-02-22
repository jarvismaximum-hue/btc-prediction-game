# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json ./
COPY client/package.json client/package-lock.json* ./client/
COPY server/package.json server/package-lock.json* ./server/

# Install dependencies
RUN cd client && npm install && cd ../server && npm install

# Copy source
COPY client/ ./client/
COPY server/ ./server/

# Build client and server
RUN cd client && npm run build
RUN cd server && npm run build

# Stage 2: Production
FROM node:20-alpine

WORKDIR /app

# Copy server package and install production deps
COPY server/package.json server/package-lock.json* ./server/
RUN cd server && npm install --omit=dev

# Copy built server
COPY --from=builder /app/server/dist ./server/dist

# Copy built client
COPY --from=builder /app/client/dist ./client/dist

# Copy root package.json for the start script
COPY package.json ./

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "server/dist/index.js"]
