# Stage 1: Build Frontend and Backend
FROM node:20-slim AS builder
WORKDIR /app

# Copy root and workspace package files
COPY package*.json ./
COPY server/package*.json ./server/
COPY frontend/package*.json ./frontend/

# Install all dependencies (in root, server, and frontend)
RUN npm install
RUN npm --prefix server install
RUN npm --prefix frontend install

# Copy source configuration files
COPY tsconfig.json ./
COPY server ./server
COPY frontend ./frontend

# Build frontend production bundle and backend TypeScript files
RUN npm --prefix frontend run build
RUN npm --prefix server run build

# Stage 2: Production Execution Environment
FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production

# Copy built artifacts from builder stage
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/server/package*.json ./server/
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/frontend/dist ./frontend/dist

# Install production-only server dependencies
RUN npm --prefix server install --omit=dev

# Fly.io default port mapping
EXPOSE 8080
ENV PORT=8080

# Launch server
CMD ["node", "server/dist/index.js"]
