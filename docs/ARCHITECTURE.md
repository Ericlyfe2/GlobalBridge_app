# GlobalBridge Mobile API — Architecture

> **What this document is.** An accurate description of the service in `backend/`: what it
> is for, what it currently does, the reasoning behind the non-obvious decisions, and an
> explicit list of what is *not* built yet. Verified against the code on **2026-08-22**.
>
> **What this project is.** A standalone API built to serve a native GlobalBridge mobile
> client. It shares the PostgreSQL database and the Firebase Auth tenant with the existing
> GlobalBridge web platform, and it does not modify that platform's repository in any way.

---

## 1. Why this service exists

The existing web app never talks to its Express backend directly. Every call goes
`browser → Next.js rewrite → Express`, and that rewrite is quietly doing four jobs:

1. eliminating CORS — everything is same-origin
2. hiding the backend URL from the client bundle
3. holding the OpenAI key server-side
4. **hosting eight AI features itself** as Next.js route handlers — `chat`, `scam-check`,
   `visa-roadmap`, `readiness`, `doc-check`, `score-essay`, `compare-countries`, `translate`

**A mobile app has no rewrite layer.** It calls an API directly over the public internet, so
all four of those jobs break at once — and the fourth is the expensive one. A native client
pointed at the web platform's Express service alone would get a GlobalBridge with no Scam
Shield, no Document Checker, no Visa Roadmap, no readiness score, no essay scoring and no
country comparison: the AI surface that is most of the product's value.

This service is the answer to that. It is the API a phone can talk to.

---

## 2. The AI path — decision

**Decision: the AI surface belongs in the API (Option A), and this service is where it
lands.** Implemented — see §9a for what the port actually produced.

**The alternative considered.** Leave the eight handlers in Next.js and let mobile call the
Next.js server for AI and this service for everything else. It ports nothing and risks no
regression to the web app, which is a real advantage and the reason it was considered
seriously.

**Why it was rejected.** It makes the app depend on two base URLs and two deploy targets,
requires CORS configuration on the Vercel side for a native origin, and — the decisive
part — makes "AI is down independently of the API" a failure mode the app has to model in
its UI. That is a permanent complexity cost paid by every screen, in exchange for avoiding
a one-time port.

**Why Option A.** The existing AI design is already backend-shaped:
`rateLimit → strict-JSON prompt → extractJson → mockFallback`, admin feature flags in
`platform_settings`, and `ai_usage_log` / `ai_feedback` for observability. All of it is
server-side machinery that happens to be running in a Next.js process. Duplicating it
across two runtimes is precisely how a stale model identifier ends up live in one copy and
not the other — a class of bug this codebase has already had once.

**Binding consequences, now in force.**

- The eight handlers are `/api/v1/ai/*` here, with exactly one implementation.
- Next.js route handlers become **thin proxies**, not a second copy. (Not written — that
  edit belongs to the web repository, which this project does not touch.)
- The fallback behaviour and the disabled-state honesty rules survived the port: a disabled
  feature returns an explicit disabled response rather than pretending to work, and
  `scam-check` defaults to the **cautious** verdict when it cannot run. A scam checker that
  fails open is worse than one that is switched off.
- One rate limiter, one usage log, one place the OpenAI key lives.

**The cost, stated plainly.** This service's uptime now gates AI features, and web gains a
hop. Both are accepted.

---

## 3. Shape

```
mobile app ──┐
             ├──> globalbridge-mobile-api (this) ──> PostgreSQL 16 (shared)
web (later) ─┘            │                     └──> Firebase Admin (identity, FCM)
                          └──> Redis (optional)
```

- **Runtime** — Node 24, Express 4.21, TypeScript, strict mode.
- **Data** — PostgreSQL 16, shared with the web platform. `query<T>()` / `queryOne<T>()`
  with parameterised SQL. No ORM: every statement is readable as the SQL that runs.
- **Identity** — Firebase Auth. Postgres holds the profile; `users.firebase_uid` joins them.
- **Redis** — optional everywhere. The server must boot without `REDIS_URL`.

### Repository layout

```
backend/src/
  app.ts                    Express assembly, middleware order, dual mounting
  index.ts                  process lifecycle, graceful shutdown
  ws.ts                     WebSocket: auth, heartbeat, fan-out
  db.ts, env.ts             pool + optional Redis; fail-fast config
  lib/         version, pagination, i18n, deep-links, sanitize, push, firebase-admin
  lib/ai/      client, config, guard, usage, pricing, prompts, fallbacks, rag, json
  middleware/  auth, client-version, csrf, error
  routes/      app-config, auth, users, housing, opportunities, messages, content
  routes/ai/   chat, scam-check, doc-check, visa-roadmap, readiness,
               score-essay, compare-countries, translate, conversations
  scripts/     seed-pagination.ts
db/migrations/              node-pg-migrate, SQL, ordered
```

---

## 4. Versioning and the update gate

Every router is mounted **twice**: at `/api/v1/*` and at its unversioned path. The same
router object, so the two cannot drift. The unversioned paths are permanent aliases, not a
deprecation with a date on it — the web platform proxies to them.

`GET /api/v1/app-config` is the single cold-start call. It returns `minSupportedVersion`,
`latestVersion`, `updateUrl`, `maintenanceMode`, `features`, `aiConfig`, the locale list and
the WebSocket path. The AI config is folded in rather than left as a second endpoint because
on a cold start every round trip is paid on the worst network the user will have all day.

`clientVersionGate` reads `X-Client-Platform` and `X-Client-Version` and answers **426
Upgrade Required** with a structured body for builds below the floor.

**The exemptions matter.** `/app-config` and `/health` always answer, even to a refused
build. `app-config` is how the app learns why it was blocked and where to update; gating it
would leave the update screen with nothing to render. An absent version header is not "too
old" — that is the web frontend and server-to-server callers, and refusing them would break
every current consumer to gate a client that does not exist yet. An *unparseable* version is
also let through: that is a client bug, and telling the user to update is advice that will
not fix it.

**Raising the floor is a user-facing action.** Anyone who cannot update — an old device, no
free storage, a country where the store is restricted — loses access to their visa
checklist. It is for contract breaks and security fixes, not convenience.

---

## 5. CORS and CSRF for a client with no origin

A native build sends **neither `Origin` nor `Referer`**. `csrfProtection` lets header-less
requests through, and the reason is worth stating precisely, because it looks like a hole:

CSRF is an attack on *ambient* credentials — the browser attaching a cookie to a request the
user did not intend to make. This API authenticates with a Bearer token that has to be read
out of secure storage and attached deliberately. An attacker's page cannot make a browser
attach it.

**So the invariant is narrow: this carve-out holds only as long as no endpoint here accepts
cookie authentication.** The moment one does, a header-less request stops being unforgeable
and this has to become a token check.

A request that *does* carry an Origin is a browser request and is held to the allow-list.
Both halves are permanent regression tests (`http-gates.test.ts`), not a one-time manual
check: a widened carve-out still returns 200 to every legitimate caller, so nothing about
normal operation would reveal the regression.

`CORS_ORIGIN` is comma-separated and is split before reaching `cors()` — passing the raw
string emits one malformed header that no browser accepts, and multi-origin CORS then fails
for every origin at once.

---

## 6. Pagination

One envelope on every list endpoint:

```json
{ "items": [...], "total": 142, "limit": 20, "offset": 0, "hasMore": true }
```

plus the existing top-level key (`listings`, `opportunities`, …) duplicated additively, so
the web frontend keeps working. That duplicate is a deprecation, not part of the contract.

Three decisions inside it:

- **`hasMore` comes from a real total, never from `items.length === limit`.** Inferring it
  makes a client fetch one empty page at the end of every list, and gets the last page wrong
  whenever the total is an exact multiple of the limit.
- **The count is `COUNT(*) OVER()` in the same statement as the page**, so the filter
  predicate exists once. Two statements means two WHERE clauses kept identical by hand, and
  when they drift `hasMore` starts lying.
- **Every ORDER BY ends in a unique tiebreaker (`id`).** Without it, rows with equal sort
  keys shuffle between pages: an infinite scroll shows the same listing twice and never
  reaches the end.

`limit` is capped at 100 and `offset` must be `>= 0`, both Zod-coerced — a querystring is
always strings, and an unbounded limit is a denial-of-service primitive.

**This class of bug is invisible to every other kind of testing.** A capped endpoint returns
200 with rows in it; unit tests pass; a click-through against five listings looks perfect.
`npm run seed:pagination` seeds past the cap and walks to the end, asserting termination and
no duplicates.

---

## 7. Auth

Firebase owns credentials, this service owns the profile, `users.firebase_uid` joins them.

`requireAuth` verifies with **`checkRevoked: true`**, on REST and on the WebSocket
handshake alike. Without it, a token issued before an account was suspended keeps verifying
until it naturally expires — JWTs are stateless, so "we revoked their sessions" means
nothing to a signature check. An admin suspending an abusive account has to take effect on
the next request, not up to an hour later.

**The client is told *why* a 401 happened.** `auth/revoked` means sign out and show the
session-ended screen; `auth/invalid-token` means refresh once and retry. Collapsing both
into "Invalid token" produces a client that either retries forever or signs the user out
every time it has been backgrounded for an hour — and a backgrounded mobile app misses
proactive refresh far more often than a backgrounded tab does.

**The user cache** maps `firebase_uid → { id, role }` for 60 seconds. It is keyed by UID and
not by token, so a user signed in on a phone and a laptop shares one entry and both devices
see a role change at the same moment. `clearUserCache` fires on the in-band cases; the TTL
bounds the rest.

**Self-heal and its trap.** A verified identity with no profile row gets a minimal one
created. That is only safe because `checkRevoked` has already established the Firebase
account still exists — without it, a token from a deleted account would recreate the row it
was deleted with. The registration flow's mirror image is the client's responsibility: if
the profile write fails after the Firebase account is created, the app must call
`cred.user.delete()`, or the user is left with credentials that authenticate to nothing and
an email address they cannot re-register.

`POST /auth/register-profile` refuses a second call (`profile_completed_at`). Row-existence
cannot distinguish a first registration from a replay, and without the guard any account
could re-POST to reassign its own role — privilege escalation dressed as a signup call.

---

## 8. Real-time, push, and the gaps a sleeping client creates

### WebSocket

`ws://host/ws`, 10s auth timeout, `clients: Map<userId, Set<Client>>` for multi-device.

**Two auth paths.** The query-string token is kept for the web client. New clients send
`{ type: "auth", token }` as the first frame, because a query string lands in proxy logs,
access logs and error reporting — a durable copy of a live credential in places that are not
treated as secret.

**Heartbeat.** The OS kills backgrounded sockets without telling either end, and TCP will
hold a half-open connection for a long time — so the server keeps "delivering" to a socket
nobody is reading, which looks like working delivery right until the user notices they
missed a message. A 30s ping/pong with a server-side sweep turns that into a detectable
close. Dead sockets are `terminate()`d, not `close()`d: a half-open connection never
completes a closing handshake.

**Replay.** A socket that was down delivered nothing, and the client cannot tell that from
"nothing happened". `GET /messages/since?cursor=` and `GET /content/notifications?since=`
are the reconcile-on-foreground path. Cursors are `(created_at, id)` — ties broken so two
messages in the same millisecond cannot straddle a page boundary and vanish. An absent
cursor means a 7-day window, not "everything ever": an unbounded backfill over a metered
connection is a bill, not a feature.

### Notifications

The order is the design: **row first**, then fan-out.

```
1. INSERT notifications   ← source of truth
2. WebSocket              ← app is open now
3. Web push               ← browser subscribed
4. FCM                    ← app installed, closed
```

Steps 2–4 all fail silently in normal operation: notifications denied at the OS level, an
expired subscription, a token from an uninstalled app, no network. If any of them were the
record, those users would simply never learn a deadline moved. Because the row is written
first, everyone still sees it in the app. Nothing in `dispatchNotification` throws — booking
a mentor has to succeed even when push is misconfigured.

**Collapsing, and its exceptions.** Repeats sharing a `collapseKey` fold into one delivery,
so ten messages from one person is one notification. `security` and `deadline` **never**
collapse and always send high-priority: collapsing means the second one silently replaces
the first, and those are exactly the two categories where the second one is often the one
that matters. This audience is actively targeted by scams and is working against immigration
deadlines.

**Localisation is server-side.** A push notification is rendered by the OS from the payload
we send — the app is not running and cannot translate anything. Text is resolved from
`users.preferred_language` before sending, with per-key fallback to English: a
half-translated locale is normal during a rollout, a blank lock screen is not.

**Deep links are validated before storage.** A notification row is data with more than one
writer, and a link the client opens without a further prompt is not a place to assume every
future writer used the route map. Anything that is not one of our own relative paths is
replaced with `/notifications`.

### Device tokens

**Unregistering on sign-out is not optional.** An FCM token belongs to an app install, not a
person. Left mapped to the previous user, the next person to sign in on that phone receives
their message previews, visa deadlines and security alerts on the lock screen. This
product's users share phones. Registration also reassigns a token away from any other
account holding it, and unregistration is scoped to the caller — otherwise anyone holding a
token string could silence another user's security alerts.

---

## 9a. The AI surface

Eight features, all at `POST /api/v1/ai/*`: `chat`, `scam-check`, `doc-check`,
`visa-roadmap`, `readiness`, `score-essay`, `compare-countries`, `translate`. Plus
`/ai/conversations`, `/ai/usage/today` and `/ai/status`.

**What the port removed.** Every one of these used to be a Next.js route handler that
reached back into the API over HTTP to do its work: verify the token (`GET /auth/me`),
check the budget (`GET /ai/usage/today`), retrieve context (`POST /rag/search`), read the
admin config (`GET /content/ai-config`), write the ledger (`POST /ai/usage`), persist the
transcript (`POST /ai/messages`). Six network calls, each with a timeout to choose and a
failure mode to decide, to do work the API already had in-process. They are function calls
and queries now. That is the whole argument for Option A, and it is why `chat.ts` is
shorter than the handler it replaces despite doing more.

**The pipeline**, unchanged in shape:

```
requireAuth → aiGuard(feature) → admin flag → strict-JSON prompt → extractJson → fallback
                  │
                  ├─ burst limit (per user, per feature, in-process)
                  └─ daily spend ceiling (per user, from ai_usage_log)
```

`aiGuard` runs both checks *before* the model, so an over-budget request costs nothing. The
burst limit is per-process and therefore approximate; that is acceptable precisely because
the spend ceiling underneath it is database-backed and is not. When the ledger is
unreachable the request is **allowed** — failing closed would take the entire AI surface
down over an infrastructure blip unrelated to anyone's budget, and the burst limit plus the
per-feature input caps still bound the damage.

**Input caps exist because `max_tokens` only caps the reply.** Without one, a single request
can carry megabytes of prompt — the expensive half, and the half an attacker controls.

**Honesty rules, per feature.** Every degraded path is labelled, and none of them
impersonates a real result:

| Feature | No model available | Admin switched it off |
|---|---|---|
| `scam-check` | heuristic scan, **floored at "Be cautious"** | explicit `disabled`, cautious band |
| `doc-check` | the standard checklist, every item `warn` | explicit `disabled` |
| `visa-roadmap` | generic roadmap, flagged `degraded` | — |
| `readiness` | user's own scores + lowest-pillar-first actions | — |
| `translate` | source strings back, flagged `degraded` | source strings, flagged |
| `chat` | honest "unavailable" reply, `degraded` | honest "turned off" reply |
| `score-essay` | **503** — no fallback exists | — |
| `compare-countries` | **503** — no fallback exists | — |

Two of those deserve their reasoning stated:

- **Scam Shield floors at "Be cautious" (score 40) when it cannot run properly.** A clean
  heuristic pass is not evidence of safety, it is evidence that eight regexes did not
  match. The user is standing in front of a decision about whether to wire someone a
  deposit, and silence from a safety tool reads as approval. There is no path through that
  handler that returns "Likely safe" without a real analysis behind it.
- **Essay scoring returns 503 rather than a canned review.** A fabricated review quotes
  passages the user did not write and scores work the model never read — for a document
  they are about to submit to a university. "We could not review this" is the only honest
  failure.

**Sources are labelled by provenance, not by model self-report.** A URL that came out of
the curated knowledge base is `knowledge_base`; one the model produced from its own weights
is `web` and is presented as something to check. This audience acts on these links.

**Model coercion.** `platform_settings.ai_model` is validated before use. The web
platform's seed shipped `ai_model = "claude-haiku-4-5"` while the calling code speaks the
OpenAI chat-completions API — so every request failed at the provider and landed silently
in the mock fallback. The product *looked* like a working AI giving suspiciously generic
answers, which is the hardest kind of failure to notice because nothing errors. A model
whose id does not match the configured provider is now refused with a loud log and replaced
with `gpt-4o-mini`. The check is provider-shaped rather than an allow-list: new OpenAI
models ship faster than this file is edited, and refusing a valid new one would be its own
outage.

**Cost** is derived from tokens on read, never stored, so a price correction reprices
history. An unpriced model is charged at a punitive fallback rate rather than treated as
free — the ceiling arriving early is the safe direction to be wrong in.

**Retrieval** is pgvector over `knowledge_base`, with two cache layers in front of the
embedding call (Redis, then Postgres) so only a miss on both spends money. When embedding
fails it falls back to Postgres full-text search rather than answering ungrounded — an
ungrounded answer about a visa fee is the failure this layer exists to prevent.

---

## 9. Not built yet

Listed rather than glossed over. None of these is blocked; they are the next passes.

- **Scheduled reminders.** Deadline, checklist and booking reminders have nothing calling
  `dispatchNotification()`. The timezone groundwork is in (`users.timezone`,
  `mentor_bookings.student_timezone` and a new `mentor_timezone`) but no scheduler runs.
  A reminder job that ignores those columns will fire at the wrong hour for most users, and
  it needs a `reminders_sent` ledger so a restart mid-run does not re-fire.
- **File uploads.** No upload path exists here. It should be pre-signed object storage —
  the image never transits Express — with magic-byte MIME validation, EXIF stripping (GPS
  in a photo of a passport is a real privacy leak for this audience), and short-lived signed
  URLs for retrieval.
- **`GET /home` and `GET /sync?since=`.** The mobile-shaped aggregates. Not built.
- **Redis-backed rate limiting.** The limiter is keyed by authenticated user id when a
  bearer token is present, falling back to IP — which is the actual fix for carrier-grade
  NAT. But counters are **per-process**: with more than one instance this under-counts by
  the instance count.
- **The mobile client itself.** No `mobile/` package yet. This pass is the API.
- **Live verification.** The suite is unit and route-handler level and runs with Postgres,
  Firebase and OpenAI mocked. The checks that need a real database, a real key and two real
  devices — suspended-token rejection on REST *and* WebSocket, a push arriving after
  sign-out reaching nobody, paging past 100 real rows, and **any AI feature against a live
  model** — have **not** been run. `seed-pagination.ts`
  exists for the third; the others need a disposable account against a real project.

---

## 10. Conventions

Non-negotiable, because each one is a bug that has already happened somewhere:

| Rule | Why |
|---|---|
| Parameterised SQL only. Never interpolate a value into a statement. | — |
| All free-text search goes through `escapeLike()` **and** `ESCAPE '\'`. | A literal `%` otherwise matches every row and the filter silently does nothing. |
| Zod validates every body and querystring; coerce, don't trust. | A querystring is always strings. |
| Every endpoint enforces its own authorization. Client guards are UX only. | — |
| `checkRevoked: true` on REST and WebSocket alike. | Suspension must apply to real-time too. |
| Notification row is written before any fan-out. | Losing push must never lose information. |
| Never cache an authenticated response in a shared store. | `Cache-Control: no-store` on everything user-specific. |
| Redis stays optional. | The server must boot without it. |
| A missing/absent resource the caller may not see returns **404, not 403**. | A 403 confirms the resource exists. |
