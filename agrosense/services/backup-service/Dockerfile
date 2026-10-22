FROM node:20-alpine

# Cliente de MariaDB: mariadb-dump para respaldar y mariadb para restaurar
RUN apk add --no-cache mariadb-client

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Los respaldos viven en un volumen propio, nunca dentro del repo
RUN mkdir -p /backups
VOLUME ["/backups"]

EXPOSE 3000

CMD ["npm", "run", "dev"]
