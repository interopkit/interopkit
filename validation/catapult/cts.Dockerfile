# The content suite's service from its pinned sources and their lockfile, without the client UI.
ARG BASE=node:18@sha256:eb29363371ee2859fad6a3c5af88d4abc6ff7d399addb13b7de3c1f11bdee6b9
FROM ${BASE}
ENV NODE_ENV=production
WORKDIR /usr/src/app
COPY service/package.json service/package-lock.json ./
# The lockfile pins knex-stringcase 1.4.5, which lacks the default export lib/db.js reads; 1.5.5 is the version the player ships.
RUN npm ci --omit=dev --ignore-scripts && npm install --omit=dev --ignore-scripts --no-save knex-stringcase@1.5.5 && npm rebuild bcrypt
COPY service ./
COPY migrations ./migrations
USER node
CMD ["sh", "-c", "node node_modules/knex/bin/cli.js migrate:latest && exec node index.js 3399 0.0.0.0"]
