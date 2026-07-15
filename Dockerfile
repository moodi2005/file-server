# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS build

WORKDIR /app

# Copy lockfiles first
COPY package.json yarn.lock ./

# Crucial: Rewrite the mirror URLs in yarn.lock to use the official NPM registry on the fly
RUN sed -i 's|https://mirror-npm.runflare.com|https://registry.npmjs.org|g' yarn.lock

# Now Yarn will bypass the mirror entirely
RUN yarn install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN yarn bundle


FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY package.json yarn.lock ./

# Crucial: Perform the same rewrite in the production runtime stage
RUN sed -i 's|https://mirror-npm.runflare.com|https://registry.npmjs.org|g' yarn.lock && \
    yarn install --frozen-lockfile --production && \
    yarn cache clean

COPY --from=build /app/dist/index.js ./dist/index.js
COPY --from=build /app/dist/package.json ./dist/package.json

VOLUME ["/data"]

RUN mkdir -p /data && chown -R node:node /data

USER node

EXPOSE 2005

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.port||2005)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]