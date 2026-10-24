FROM node:20-alpine

WORKDIR /app

# Copy package manifests for deterministic dependency resolution
COPY package*.json ./
COPY packages/bff/package*.json ./packages/bff/

# Install BFF dependencies within monorepo context
RUN npm install --workspace=packages/bff --include-workspace-root=false

# Copy BFF application code
COPY packages/bff ./packages/bff

WORKDIR /app/packages/bff

EXPOSE 3000

CMD ["node", "src/server.js"]
