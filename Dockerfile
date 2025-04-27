# Use official Node.js image with full build tools
FROM node:18

# Install system dependencies for canvas and native modules
RUN apt-get update && \
    apt-get install -y \
    build-essential \
    python3 \
    make \
    g++ \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev

# Create app directory
WORKDIR /usr/src/app

# Install npm dependencies
COPY package*.json ./
RUN npm install --production

# Bundle app source
COPY . .

# Environment variables
ENV NODE_ENV=production

# Run the bot
CMD ["node", "index.js"]
