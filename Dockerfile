FROM node:18

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY server/ ./server/
COPY public/ ./public/

EXPOSE 8080

CMD ["node", "server/server.js"]
