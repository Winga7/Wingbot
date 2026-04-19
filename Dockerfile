# syntax=docker/dockerfile:1.6

# ---------- Étape 1 : install des dépendances ----------
# Image avec build tools pour compiler les modules natifs (better-sqlite3).
FROM node:20-bookworm-slim AS deps

WORKDIR /app

# better-sqlite3 doit être recompilé côté Linux (impossible de copier les
# node_modules d'un Mac/Windows tels quels). On installe les outils de build
# uniquement le temps de l'install, puis on les retire pour garder une image
# légère.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./

# `npm ci` si lockfile présent, sinon fallback `npm install`.
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; \
    else npm install --omit=dev; fi

# ---------- Étape 2 : runtime ----------
FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false

# Le port du dashboard (sera ignoré par le conteneur "bot" qui n'expose rien).
EXPOSE 3847

# UID/GID sous lesquels tournera le process. Par défaut 1000:1000 (= utilisateur
# Linux standard sur l'hôte) pour que le bind-mount ./data:/app/data soit
# lisible/écrivable des deux côtés sans chown manuel.
#
# Note : l'image node:20-bookworm-slim contient déjà un user "node" (UID 1000),
# donc on n'essaie PAS d'en créer un nouveau — on réutilise simplement l'UID/GID
# déjà présent. On référence le user par numéro (USER 1000:1000) pour éviter
# tout conflit de nom.
#
# Pour utiliser un autre UID (rare) :
#   docker compose build --build-arg APP_UID=$(id -u) --build-arg APP_GID=$(id -g)
ARG APP_UID=1000
ARG APP_GID=1000

WORKDIR /app

# Récupère les node_modules compilés à l'étape précédente.
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Le dossier data accueille wingbot.db + ses fichiers WAL associés. Ce dossier
# est censé être un volume Docker partagé entre le conteneur bot et dashboard
# (cf. docker-compose.yml).
RUN mkdir -p /app/data && chown -R ${APP_UID}:${APP_GID} /app

USER ${APP_UID}:${APP_GID}

# Par défaut, le conteneur lance le bot. Le service "dashboard" du
# docker-compose surcharge cette commande avec `npm run dashboard`.
CMD ["node", "index.js"]
