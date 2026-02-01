# Dev container for Melanoma Tissue Volumes — runs the Vite dev server.
#
# The 4.8 GB visualization_data is NOT baked into the image; it's bind-mounted
# at runtime (see docker-compose.yml). The LLM is a browser → your-local-endpoint
# call (configured in the app's Settings), so no model runs in this container.

FROM node:24-bookworm-slim

WORKDIR /app

# Install dependencies first for better layer caching. (The linux esbuild/rollup
# binaries are fetched here, so node_modules must come from the image, not a host
# mount — docker-compose keeps it as a separate volume.)
COPY package.json package-lock.json ./
RUN npm ci

# App source. The dataset and node_modules are excluded via .dockerignore.
COPY . .

EXPOSE 3000

# Bind to 0.0.0.0 so the dev server is reachable from the host browser.
CMD ["npx", "vite", "--host", "0.0.0.0", "--port", "3000"]
