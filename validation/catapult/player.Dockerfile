# The player from its pinned sources and lockfile, on the linux/amd64 image of node:18, the platform of CI. The lockfile pins tar 6 where package.json asks for 7, so npm ci refuses it;
# npm install keeps every other locked version. The node_modules.tar.gz the archive ships holds knex-stringcase 1.5.5, which
# lib/db.js cannot call.
FROM node:18@sha256:eb29363371ee2859fad6a3c5af88d4abc6ff7d399addb13b7de3c1f11bdee6b9
ENV NODE_ENV=production
WORKDIR /usr/src/app
COPY service/package.json service/package-lock.json ./
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund
COPY service ./
COPY migrations ./migrations
RUN rm node_modules.tar.gz && mkdir -p var/content && chown -R node:node var
USER node
CMD ["sh", "-c", "node node_modules/knex/bin/cli.js migrate:latest && exec node index.js 3398 0.0.0.0"]
