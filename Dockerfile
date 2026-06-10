FROM oven/bun:1
WORKDIR /usr/src/app

COPY package.json bun.lock ./
RUN bun install

COPY . .
RUN bun run build

CMD ["bun", "run", "start"]