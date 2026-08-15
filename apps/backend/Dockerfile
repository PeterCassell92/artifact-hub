# Backend image. BUILD FROM THE REPO ROOT so the yarn workspace (incl. packages/contracts)
# resolves:   docker build -f apps/backend/Dockerfile -t artifact-hub-backend .
#
# contracts is compiled into the backend output at build time — no separate runtime artifact
# (answers the "does the shared package complicate deployment?" question: it does not).

FROM node:20-slim AS build
WORKDIR /repo
RUN corepack enable

# Manifests first for better layer caching
COPY package.json yarn.lock .yarnrc.yml tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/backend/package.json apps/backend/
RUN yarn install --immutable

# Sources
COPY packages/contracts packages/contracts
COPY apps/backend apps/backend

RUN yarn workspace contracts build \
 && yarn workspace backend prisma:generate \
 && yarn workspace backend build

# ── runtime ──
FROM node:20-slim AS runtime
WORKDIR /repo
ENV NODE_ENV=production
RUN corepack enable
COPY --from=build /repo /repo
EXPOSE 3000
# The full /repo (incl. node_modules with the Prisma CLI + prisma/schema.prisma + prisma/migrations)
# is present, so Fly's release_command can run `yarn workspace backend db:deploy` (prisma migrate
# deploy) before traffic shifts (docs 07/08). The container itself just serves.
CMD ["node", "apps/backend/dist/index.js"]
