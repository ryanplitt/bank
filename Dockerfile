# ---- Build stage: install deps and build the client ----
FROM node:22-alpine AS build
WORKDIR /app

# Install all workspace dependencies first (cached as its own layer).
COPY package.json package-lock.json ./
COPY BankGame/shared/package.json BankGame/shared/package.json
COPY BankGame/server/package.json BankGame/server/package.json
COPY BankGame/client/package.json BankGame/client/package.json
RUN npm ci

# Copy source and build the client bundle.
COPY . .
RUN npm run build

# ---- Runtime stage: server serves the built client + WebSocket on one port ----
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

# Install only production deps for the server workspace.
COPY package.json package-lock.json ./
COPY BankGame/shared/package.json BankGame/shared/package.json
COPY BankGame/server/package.json BankGame/server/package.json
COPY BankGame/client/package.json BankGame/client/package.json
RUN npm ci --omit=dev

# Server source and shared source.
COPY BankGame/shared BankGame/shared
COPY BankGame/server BankGame/server

# The built client from the build stage.
COPY --from=build /app/BankGame/client/dist BankGame/client/dist

EXPOSE 8080
CMD ["node", "BankGame/server/index.js"]
