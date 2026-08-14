FROM node:20-slim

RUN apt-get update && apt-get install -y python3 python3-pip --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

RUN pip3 install --break-system-packages httpx pypdf pyyaml google-auth google-api-python-client

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 3005
CMD ["node", "server.js"]
