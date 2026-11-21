FROM node:20-alpine

WORKDIR /app

# Copy package manifests
COPY package*.json ./

# Install dependencies
RUN npm install --omit=dev

# Copy application source code
COPY . .

ENV HOST=0.0.0.0
EXPOSE 3000
EXPOSE 10000

CMD ["node", "src/server.js"]
