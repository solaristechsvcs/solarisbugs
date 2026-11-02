FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY . .
RUN mkdir -p uploads && chown -R node:node /app
USER node
EXPOSE 3014
CMD ["node", "server.js"]
