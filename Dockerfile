FROM node:21-alpine3.17

ENV VERSION 0.0.0
WORKDIR /usr/app


ADD ./build .
ADD ./node_modules ./node_modules
ADD ./package.json ./package.json

RUN yarn isharp
EXPOSE 80

CMD ["node","index.js"]