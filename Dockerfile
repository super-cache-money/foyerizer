FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
# Install all deps (including wrangler devDep, needed for deploy step)
RUN npm ci
COPY . .
RUN chown -R node:node /app
USER node
EXPOSE 3001
CMD ["node", "foyer-generator.js"]
