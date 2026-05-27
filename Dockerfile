FROM node:26-alpine3.22

WORKDIR /usr/app


ADD ./build .
ADD ./node_modules ./node_modules
ADD ./package.json ./package.json

RUN rm -rf node_modules package-lock.json
RUN npm  install


EXPOSE 80


CMD ["node","index.js"]