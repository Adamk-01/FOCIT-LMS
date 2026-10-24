FROM node:20-alpine

WORKDIR /app

# Copy root monorepo manifests
COPY package*.json ./
COPY packages/frontend/package*.json ./packages/frontend/

# Install frontend dependencies
RUN npm install --workspace=packages/frontend --include-workspace-root=false

# Copy frontend source
COPY packages/frontend ./packages/frontend

WORKDIR /app/packages/frontend

EXPOSE 5173

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5173"]
