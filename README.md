# GlobalBridge App

The API that serves the GlobalBridge native mobile client, plus (later) the client itself.

This is a **standalone project**. It shares the PostgreSQL database and the Firebase Auth
tenant with the existing GlobalBridge web platform, and it does not modify that repository.

Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) before changing anything — including
§9, which lists what is deliberately not built yet.

## Status

The backend foundation is in: API versioning and the update gate, native-origin CORS/CSRF,
a uniform pagination envelope, Firebase auth with revocation checking, a WebSocket layer
built for a client that sleeps, and native push with device-token management.

The AI surface is ported (§2, §9a): eight features at `/api/v1/ai/*`, one implementation
each, one rate limiter, one spend ledger, one place the OpenAI key lives. Every feature
degrades honestly without a key rather than pretending to have run.

Not built yet: scheduled reminders, file uploads, the aggregate endpoints, and the mobile
app. See §9.

## Setup

```bash
npm install
cp .env.example .env   # then fill in Firebase + DATABASE_URL
npm run migrate
npm run dev
```

The server refuses to start on invalid configuration and prints every problem at once — a
mobile client cannot be told "the server was misconfigured" in any useful way, so failing
loudly at boot is the honest option.

## Commands

```bash
npm run dev             # watch mode
npm test                # unit + route-handler tests
npm run typecheck       # tsc --noEmit
npm run migrate         # apply migrations
npm run migrate:status  # dry run — show what would apply
```

## Verifying pagination against a real database

The bug this guards against is invisible to unit tests: a capped list endpoint returns 200
with rows in it, and a click-through against five listings looks perfect.

```bash
npm --workspace backend run seed:pagination -- --count 150
```

Seeds past the page cap, walks every page, and asserts the walk terminates with each row
seen exactly once. Everything it writes is tagged; `-- --cleanup` removes precisely that.

## What must not go in the mobile bundle

The OpenAI key, Firebase Admin credentials, database credentials, VAPID private keys. The
backend is the security boundary. Only values that are safe for public exposure belong
behind an `EXPO_PUBLIC_` prefix.
