FROM ghcr.io/puppeteer/puppeteer:latest

USER root

# Install necessary libraries for WhatsApp Web
RUN apt-get update && apt-get install -y \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Set environment variables
ENV PORT=3000

EXPOSE 3000

CMD ["node", "index.js"]
