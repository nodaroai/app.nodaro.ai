# The base image's Playwright and the package.json pin MUST be the same version: the image carries
# the browser build that exact Playwright release expects. Bump both together.
FROM apify/actor-node-playwright-chrome:22-1.63.0
COPY --chown=myuser package.json package-lock.json ./
RUN npm ci --omit=dev --omit=optional --no-audit --no-fund \
 && node -e "const v=require('playwright/package.json').version; if (v !== '1.63.0') { console.error('playwright ' + v + ' does not match the base image (1.63.0)'); process.exit(1) }"
COPY --chown=myuser . ./
CMD ["node", "src/main.mjs"]
