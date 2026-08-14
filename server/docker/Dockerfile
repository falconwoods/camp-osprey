FROM node:22-alpine AS runner

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

WORKDIR /app

RUN addgroup -S nodejs && adduser -S nextjs -G nodejs

COPY .next/standalone ./
COPY .next/static ./server/.next/static

USER nextjs

WORKDIR /app/server

EXPOSE 3000

CMD ["node", "server.js"]
