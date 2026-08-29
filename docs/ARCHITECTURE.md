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
  middleware/  auth, client-version, csrf, error, rate-limit, query-log
  routes/      app-config, auth, users, housing, opportunities, messages,
               content, uploads, home, sync
  routes/ai/   chat, scam-check, doc-check, visa-roadmap, readiness,
               score-essay, compare-countries, translate, conversations
  lib/reminders/ store, time, bookings, opportunities, checklists
  lib/uploads/   storage, file-type, metadata, process
  lib/           etag, query-stats, rate-limit
  scheduler.ts             node-cron wiring, overlap guard
  scripts/     seed-pagination.ts
  __tests__/live/  real-Postgres suite (npm run test:live)
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

## 9b. Scheduled reminders

node-cron in-process, every 15 minutes, off unless `REMINDERS_ENABLED` is set. Three
sources: mentor sessions, saved-opportunity deadlines, and stale visa checklists.

### The timezone rule

`mentor_bookings.slot_date` is a DATE and `slot_time` is a TIME. Neither carries a zone, so
"2026-09-14, 15:00" is not an instant — it is a wall-clock reading that means six different
moments depending on who is holding the clock. `student_timezone` exists to resolve that.

**A booking has exactly one absolute instant**, derived from the stored reading interpreted
in the **student's** zone, because the student booked the slot and the time was written from
their clock. `mentor_timezone` does *not* produce a second instant — there is no second
instant. It renders that one moment on the mentor's clock, so their reminder says "8:00 AM"
where the student's says "3:00 PM". Getting this backwards produces two reminders for two
different moments and one of the pair turns up alone.

The conversion happens in SQL, in the same statement that does the filtering, so the WHERE
clause and the value carried into the notification cannot disagree about what time the
session is. Timezone names come from client input, and Postgres raises on an unrecognised
one — which would abort a whole pass over one bad profile row — so every name is checked
against `pg_timezone_names` and degrades to UTC. Rows that fall back are counted and warned
about rather than passing silently, because those reminders may land at the wrong local hour.

Deadlines are treated differently on purpose: an opportunity deadline is a DATE, a calendar
day rather than a moment, and it is formatted **without** timezone conversion. Converting it
would shift it a day for users far enough east or west, and telling someone their deadline
is the 31st when the form says the 1st is the one error that makes the feature harmful.
The *send time* is still local — 09:00 in the recipient's zone — because firing whenever the
cron pass lands would push a lock-screen alert at 3am to half the world.

### Restart and multi-instance safety

`reminders_sent` is unique on `(kind, subject_id, user_id, fire_key)`, and a reminder is
**claimed before it is dispatched**, not recorded after. That single constraint answers both
problems at once:

- **A restart mid-pass** cannot re-send what already went out. The ledger is durable.
- **A second instance** does not double-send. Two concurrent passes race on the insert and
  exactly one wins per reminder. This is why the in-process scheduler is not the usual
  liability: extra instances waste a few queries, they do not notify anyone twice. A separate
  worker process would still need the same claim logic to survive its own restarts, so the
  claim is the load-bearing part and the process topology is not.

The guarantee is *exactly once* in the normal case, and *at most twice* only if a process
dies inside the ten-minute grace window between claiming and dispatching — a claim left
hanging in `claimed` may be retaken, a row that reached `sent` never can. The direction of
that trade-off is deliberate: a user who misses a reminder misses a visa appointment, and a
user who gets one twice is mildly annoyed.

### The catch-up window

A pass looks at a window ending now and starting six hours back, so a deploy or an incident
makes reminders fire *late* rather than never. The floor matters as much as the lookback: a
"your session starts in one hour" notification delivered nine hours afterwards is not a late
reminder, it is a false one — the user believes it and turns up for a meeting that already
happened. Past the window, reminders are dropped and counted as stale.

Sources are isolated from each other. A scheduler that aborts the whole pass because one
table is locked is how every reminder goes missing at once. Every pass logs its counts,
including the quiet ones — the failure mode of a reminder system is silence, and silence is
indistinguishable from "nothing was due".

### What checklist reminders actually are, and why

§3.7 asks for reminders on `visa_checklists` items. **The data cannot support that**, and
the approximation is worse than the gap.

A checklist's `items` are roadmap phases produced by the Visa Roadmap feature:
`{ id, title, timeframe: "Weeks 1–3", cost, documents, tip }`. `timeframe` is a relative
estimate the model generated for a journey with no fixed start, and there is no due date
anywhere in the structure. Deriving a calendar date from "Weeks 1–3" means inventing a start
point and then pushing a notification asserting a deadline we made up — exactly what the AI
safety contract forbids, and worse in a push than in a chat reply because the user cannot
see the reasoning behind it.

So what ships is a **nudge about the user's own inactivity**, which is a fact we hold: a
checklist with unfinished phases untouched for 14 days. It is `kind: "info"`, not `deadline`
— miscategorising it would give it the never-collapse, high-priority delivery real deadlines
get and dilute the category users rely on — and it fires once per checklist, ever, because
nagging someone about a list they have abandoned is how notifications get switched off
wholesale. Regenerating a roadmap creates a new row, which earns a fresh nudge.

To make real item deadlines work, add an optional `due_date` to the phase schema that the
*user* sets as they work through the roadmap. That branch is not written here: nothing
produces such a field today, and shipping a code path no data can reach is dead code that
reads as a feature.

Migration 0005 also adds `visa_checklists.updated_at`, backfilled from `created_at` — the
table only ever had a creation timestamp, so "has this person touched their checklist" was
unanswerable. Until a checklist write path exists in this service, the two are equal.

---

## 9c. File uploads

`POST /uploads/presign` → client PUTs straight to the bucket → `POST /uploads/:id/complete`
→ `GET /uploads/:id` returns a 5-minute signed read URL. Unavailable, explicitly, when no
bucket is configured.

### The tension, and how it resolves

"The bytes never transit Express" and "strip EXIF before storing" cannot both be true of the
same moment — stripping metadata means rewriting the file, and rewriting it means having it.
What *can* be true is that the **upload** does not transit Express. The client's slow,
connection-bound PUT goes straight to the object store; the server then reads the object
once, from inside the same datacentre, at wire speed.

A multi-megabyte camera photo travelling through Express holds a request slot, a body-parser
buffer and the memory behind it for the entire duration of an upload over a phone's
connection — tens of seconds on 3G. A handful of concurrent uploads starves every other
request on the instance.

So the object lands in a **quarantine prefix** first. Between the PUT and validation it is
arbitrary attacker-controlled bytes that happen to be in our bucket: unsniffed, unmeasured,
unstripped. A separate prefix means a misconfigured policy or a bug in a serving path cannot
reach it, and abandoned uploads can be swept without touching real documents. The row is
`pending` throughout, and nothing is servable until it reaches `ready`.

Nothing the client says is trusted — not the size, not the MIME type, not the filename.
The declared size only buys an early rejection before a URL is issued; the quota is enforced
against the measured size at completion, where an over-quota object is deleted rather than
kept.

### Metadata stripping, and why it is lossless

A phone writes GPS coordinates into every photo. Someone photographing their passport page
is uploading a file that says where they were standing — usually home — attached to their
full legal name, nationality and date of birth. For an audience that includes asylum seekers
and people with reason not to be located, that pairing is the most dangerous thing this
product could store carelessly. EXIF also carries device serial numbers and, on some phones,
a thumbnail of the *unedited* frame — so cropping out a sensitive corner can leave the
uncropped version embedded.

The obvious implementation is to run the image through an encoder, which drops metadata as a
side effect. It also re-compresses it — and the entire value of these files is that small
print stays readable: a passport MRZ, a bank statement's figures, an acceptance letter's
reference number. Generational JPEG loss on text is exactly where artefacts show, and an
unreadable document gets rejected by an embassy.

So JPEG and PNG are stripped **at the container level**: metadata segments and chunks are
dropped, compressed image data is copied through byte for byte. Tests assert the decoded
pixels are bit-identical to the upload.

HEIC and WEBP cannot be handled that way — ISO-BMFF and RIFF interleave metadata with image
data in ways a naive rewrite gets wrong. Rather than ship a half-correct parser for the
format iPhones actually produce, those two are transcoded to JPEG at quality 92 with chroma
subsampling disabled (4:2:0 is where text picks up colour fringing first). The quality cost
is accepted specifically because an unstripped HEIC off a phone camera is the exact
GPS-on-a-passport-photo case.

After stripping, the buffer is re-checked for an EXIF marker. If one survives, the upload is
**rejected** rather than stored — storing it anyway would mean keeping location data we told
the user we removed.

### Serving

No object is ever written with a public ACL, and no permanent URL exists for a document.
`GET /uploads/:id` is the authorization boundary: the object store honours any correctly
signed URL and has no idea who is asking, so the check happens before the URL exists and the
URL expires in five minutes. A private document 404s for a non-owner rather than 403ing —
a 403 confirms a document exists at that id and belongs to someone else. Storage keys are
never returned in listings, because handing them out invites clients to construct URLs
instead of asking for one.

PDFs are served with `Content-Disposition: attachment`, never inline. A PDF can carry
embedded JavaScript, and a browser rendering one inline executes it in that context.

### Known gaps

- **PDF metadata is not stripped.** It is spread across the document catalogue, an XMP
  stream and per-object dictionaries; doing it safely needs a full parser. The
  attachment-only serving above is the mitigation, not a fix.
- **No local-disk driver.** Deliberate: a dev flow that differs from production is one that
  hides production bugs, and the ephemeral-disk fallback is what loses passport scans on
  deploy. Run MinIO locally.
- **No sweep for abandoned quarantine objects.** A client that presigns and never uploads
  leaves a `pending` row and no object; one that uploads and never completes leaves an
  object under `quarantine/`. Neither is servable or counted against quota, but both
  accumulate.
- **Client-side compression is not implemented** — it belongs in the app, which does not
  exist yet. The 15 MB ceiling assumes it is coming.

---

## 9d. Aggregate endpoints

`GET /home` — the whole first screen in one request. `GET /sync?since=` — deltas for the
local cache.

### Why /home exists

The home screen needs eight unrelated things: who you are, checklist progress, the next
deadline, the next session, two unread counts, saved items, and a few opportunities. As
separate endpoints that is eight round trips before anything renders, paid on the worst
network the user will have all day, in front of a splash screen.

Three rules keep it worth having:

- **A fixed query count.** Everything runs in one `Promise.all`, and the count does not move
  with how much data the user has. That is the property that makes an N+1 *impossible* here
  rather than merely absent today, and there is a test that asserts it by running the
  endpoint against an empty account and a populated one and comparing.
- **No unbounded arrays.** Every list carries an explicit small LIMIT. This is a summary:
  a user with four hundred saved items does not need four hundred rows to see they have
  some. Counts come back as counts; the previews have their own endpoints behind them.
- **No volatile fields.** There is no `generated_at`. A timestamp would change the ETag on
  every request and turn the whole caching mechanism into decoration.

The next session is sent as an ISO instant, resolved the same way the reminder scheduler
resolves it, so the home screen and the notification cannot disagree about when a session
is. A preformatted local time would be wrong the moment the user travels — which this
audience does by definition.

### The caching nuance

Every other authenticated response here sends `no-store`, because a shared, origin-scoped
cache holding one user's data can serve it to the next user of the same browser or proxy.

`no-store` would be the wrong instrument on `/home`, though: it also forbids the client's own
*private* cache from keeping a copy, and without a stored copy there is nothing for
`If-None-Match` to revalidate against. The ETag could then never produce a 304.

So `/home` sends `private, max-age=0, must-revalidate` plus `Vary: Authorization` — this
belongs to one user, never put it in a shared cache, and check before reusing it. The app
pays a round trip but not a payload, which on a cold start over a slow connection is most of
the cost. The ETag hashes the serialised payload, so a 304 happens exactly when the answer
really is identical.

### /sync and the deletion problem

Returned: notifications, messages, conversations, checklists, saved items. Deliberately
absent, and required to stay absent: **AI responses** (guidance generated against config and
a knowledge base that change — a cached answer about a visa fee outlives its accuracy with
no way for the client to know), **documents** (served through short-lived signed URLs
precisely so a copy does not persist somewhere unmanaged), and **anything token-shaped**.

The hard part of any delta protocol is deletions: a "changed since" query cannot report a
row that no longer exists, so unsaving an opportunity on one device leaves it on another
forever. Two honest answers, both used:

1. For `saved_items` — small, bounded, and where deletion is a normal daily action — the
   full authoritative id list comes back every time and the client reconciles by set
   difference. A few hundred bytes, and exactly correct. If the list ever exceeds its cap it
   is returned as `complete: false` and empty, because reconciling deletions against a
   truncated list would delete real rows from the client's cache.
2. For everything else deletion is rare or soft — conversations are not deleted,
   notifications are marked read rather than removed, checklists are replaced wholesale on
   regeneration — and those are covered by the full-resync rule instead.

A tombstone table would generalise this and is the right answer the moment a hard-delete
path appears for messages or notifications. It is not built because nothing produces those
deletions today.

**An old cursor forces a full resync.** Delta sync without tombstones degrades with time:
the longer a client has been away, the likelier something it holds was deleted in a way the
response cannot describe. Past 30 days the honest move is to tell the client to start over
rather than hand it a delta that quietly strands stale rows. A first call with no cursor is
the same case.

The cursor advances to the newest row returned, never to `now` — the server clock would skip
anything written between the query and the response.

### Query counting

`db.query` records into an `AsyncLocalStorage` counter, and in development every request
logs its query count and driver time; anything past twelve is logged as a warning with the
statements attached. An N+1 in an aggregate endpoint does not announce itself — the response
is correct and the tests pass, and the only symptom is a home screen that takes two seconds
instead of two hundred milliseconds. A counter printed next to every request turns that into
something you notice while writing it.

Off entirely in production: the statements array holds SQL text, and this is developer
feedback rather than a telemetry channel.

---

## 9e. Rate limiting

One counter behind both limiters — the global HTTP limit and the AI per-feature burst
limit — in `lib/rate-limit.ts`. Redis-backed when `REDIS_URL` is set, per-process otherwise,
with identical semantics either way.

### Keyed by account, not by address

Keying purely by IP is what forced the global budget up to an uncomfortably high number.
This audience sits behind campus and dorm NAT, and carrier-grade NAT puts an entire city's
mobile subscribers behind a handful of addresses — so any per-IP limit tight enough to stop
abuse also locks out hundreds of people who did nothing. A per-account key makes the budget
follow the person, which is the thing actually worth bounding. Anonymous traffic still falls
back to the address, because there is nothing else to key on.

The account id is read off the **unverified** token, before authentication runs. That is
deliberate and safe: a forged token only moves the request into a bucket the attacker chose.
It cannot raise anyone's allowance, and the request still has to pass real verification
afterwards. Verifying here instead would mean a signature check on every request we are
about to reject.

IPv6 is masked to its /64 in the fallback key. A residential IPv6 allocation is routinely a
/64 or larger, so keying on the full address lets one connection walk through billions of
distinct keys and never hit a limit — the limiter would be decorative for exactly the users
most likely to have IPv6. IPv4 is used whole, since NAT already makes those shared and
masking further would punish a whole campus for one caller.

### Why per-instance counting had to go

In-process counters mean a caller gets N times the allowance across N instances, and the
limit silently means something different after every scale-up. For the AI burst limiter that
was defensible — it guards against a runaway client loop, and the thing that actually bounds
cost is the daily spend ceiling, which is computed from a durable ledger and cannot be gamed
this way. It was still worth fixing: a runaway loop multiplied by the instance count is how
a provider rate-limits the whole service rather than one account.

### Fixed window, and the burst it permits

A fixed window lets a caller send `limit` requests at the end of one window and `limit` more
at the start of the next — a 2x burst across the boundary. A sliding log prevents that, at
the cost of storing a timestamp per request per key.

The 2x gap is accepted because these limits are abuse backstops rather than capacity
reservations, and the real cost bound is the AI daily ceiling, which window alignment cannot
touch. Paying per-request storage to close a 2x gap in a backstop is the wrong trade.

The increment and its TTL run in one Lua script. The naive two-command version has a real
failure mode: a process that dies between `INCR` and `PEXPIRE` leaves a key with no expiry,
and that caller is limited forever. The script also re-checks `PTTL` on every hit, which
self-heals any key that lost its expiry anyway.

### Failure is open

If Redis is unreachable the hit is counted in-process and the request proceeds. Failing
closed would turn a cache outage into a total outage — every user locked out of their visa
checklist because a counter was unavailable. The blast radius of failing open is that limits
become per-instance for the duration, which is exactly where they were before Redis existed.

### The client half

`GET /app-config` returns `minPollIntervalSeconds`, and every 429 carries `Retry-After` plus
a `retry_after` field in the body. The app is expected to honour both and back off
exponentially. That half does not exist yet — it belongs to the client, which does not exist
yet either.

---

## 9f. Live verification

`npm run test:live` boots a real PostgreSQL 16 in-process (`embedded-postgres`), applies the
real migrations with the real tool, and runs the real handlers against it. Only Firebase is
mocked, because verifying an ID token needs credentials this environment does not have.

It exists because every other suite mocks `query()`, and a mocked `query()` accepts a
statement that references a column no migration creates, a window function the planner would
reject, and a timezone conversion that does the opposite of what was intended — all green.

### What it found

**A table no migration created.** `0006_uploads.sql` alters `user_documents`, and nothing
ever created it — the baseline reconciliation simply omitted it. Against a fresh database
the migrations aborted, and the upload feature could never have worked. Every mocked upload
test passed throughout. Fixed by adding the table to `0001`, where the rest of the shared
schema lives.

**Cursor truncation in all three delta endpoints.** PostgreSQL stores `timestamptz` with
microsecond precision; the `pg` driver parses it into a JS `Date`, which has millisecond
precision. A cursor built from a row was therefore up to 999 microseconds *earlier* than the
row it pointed past, so `WHERE created_at > $cursor` matched that row again — and again on
every subsequent call, because each new cursor was truncated the same way. `/sync`,
`/messages/since` and `/content/notifications?since=` all re-delivered the same tail forever
and never advanced.

Invisible in the mocked suites for a specific reason: the fixtures were JS `Date`s with no
sub-millisecond component, so the truncation was a no-op and the round trip looked clean.
It only appears against a real database. Fixed in `lib/cursor.ts` — cursors are now
microsecond-precision strings produced by Postgres, never parsed into a `Date`, and cast
back to `timestamptz` in the comparison.

### What it verifies

- Migrations apply to an empty database, and re-apply without error — the idempotence claim
  in `0001` is tested by re-running the file itself, not just by the ledger skipping it.
- Every column the handlers select exists, including the drift-item timezone columns and the
  upload state machine.
- The reminder timezone conversion, against Postgres's own IANA database: a Vancouver
  booking resolves to a different UTC instant in January than in September (the assertion
  that fails for any fixed-offset implementation), half-hour and 45-minute zones are exact,
  an unknown zone degrades to UTC instead of aborting the pass, and both participants get
  the same instant rendered on different clocks.
- `/home` and `/sync` run every statement for real, including `jsonb_array_length`,
  `array_length`, `COUNT(*) OVER()` and the correlated unread-count subqueries.
- Paging through 150 housing rows reaches the end with no duplicate and no gap.
- A literal `%` in a search box matches percent signs rather than the whole table.

### What is still unverified

- **The AI surface.** `0004_ai_surface.sql` needs `pgvector`, which the embedded PostgreSQL
  build does not ship. The AI schema and every RAG query remain untested against a real
  database. Nothing else depends on those tables, so the migration is excluded from the live
  run rather than blocking it.
- **Firebase.** Token verification, revocation checking and FCM delivery all need real
  credentials. `requireAuth` is mocked at the `verifyIdToken` boundary; everything below it
  is real.
- **Object storage.** The upload pipeline's image work — sniffing, stripping, thumbnailing —
  runs against genuinely encoded images in the fast suite, but every S3 call is stubbed. No
  upload has gone to a real bucket.
- **Redis.** The Lua counter script is executed by a real Lua interpreter against an
  emulated command set, which proves the script is valid and branches correctly, including
  the lost-expiry self-heal. It is not real Redis: no network, no eviction, emulated TTLs.
- **Two devices.** Multi-device push and socket behaviour still needs two real handsets.

---

## 9. Not built yet

Listed rather than glossed over. None of these is blocked; they are the next passes.

- **Item-level checklist deadlines.** See §9b: the roadmap phase schema has no due date,
  and deriving one would mean inventing a deadline. The staleness nudge ships instead.
- **PDF metadata stripping and a quarantine sweep.** See §9c.
- **Tombstones for hard-deleted rows.** See §9d: `/sync` reconciles saved-item deletions
  from an authoritative id list and falls back to a full resync for everything else.
- **Client-side backoff.** The server sends `Retry-After` and `minPollIntervalSeconds`;
  honouring them is the client's half of §9e and does not exist yet.
- **The mobile client itself.** A `mobile/` workspace has been scaffolded outside this
  pass; the API is what these notes describe.
- **Live verification.** Partly done — see §9f for what `npm run test:live` covers and the
  five areas it still cannot reach (pgvector, Firebase, object storage, real Redis, two
  physical devices). The upload suite covers the
  stripper against genuinely encoded images and the route state machine, but every S3 call
  is stubbed. The conversion is `AT TIME ZONE` inside the query, so the unit tests cover the
  rendering half and the claim protocol but not the SQL that decides which rows are due. `seed-pagination.ts`
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
