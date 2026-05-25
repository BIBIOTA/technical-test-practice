FROM node:20-alpine AS builder

ARG NEXT_PUBLIC_INTERVIEW_TOKEN
ENV NEXT_PUBLIC_INTERVIEW_TOKEN=$NEXT_PUBLIC_INTERVIEW_TOKEN

ARG BACKEND_URL=http://backend:8000
ENV BACKEND_URL=$BACKEND_URL

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000
CMD ["node", "server.js"]
