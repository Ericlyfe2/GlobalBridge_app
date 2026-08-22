import "dotenv/config";
import { query, queryOne, pool } from "../db";

/**
 * Seed past the page cap, then page to the end.
 *
 * This exists because the pagination bug it checks for is invisible to every
 * other kind of testing. A capped list endpoint returns 200 with rows in it;
 * unit tests over the handler pass; a manual click-through against five
 * listings looks perfect. The only thing that catches it is more rows than one
 * page and a client that actually asks for the second one.
 *
 *   npm run seed:pagination -- --count 150
 *   npm run seed:pagination -- --verify
 *   npm run seed:pagination -- --cleanup
 *
 * Everything it writes is tagged so cleanup is exact -- this is meant to be run
 * against a real database, and a seeder that cannot remove precisely what it
 * added is not safe to point at one.
 */

const TAG = "[pagination-fixture]";
const FIXTURE_EMAIL = "pagination-fixture@globalbridge.invalid";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? "true") : fallback;
}

async function fixtureLandlord(): Promise<string> {
  const existing = await queryOne<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [
    FIXTURE_EMAIL,
  ]);
  if (existing) return existing.id;

  const created = await queryOne<{ id: string }>(
    `INSERT INTO users (email, full_name, role) VALUES ($1, $2, 'student') RETURNING id`,
    [FIXTURE_EMAIL, `${TAG} landlord`],
  );
  return created!.id;
}

async function seed(count: number) {
  const landlordId = await fixtureLandlord();

  for (let i = 0; i < count; i++) {
    await query(
      `INSERT INTO housing_listings
         (landlord_id, title, city, country, rent_amount, currency, status, rating)
       VALUES ($1, $2, 'Toronto', 'Canada', $3, 'CAD', 'active', $4)`,
      [landlordId, `${TAG} listing ${String(i).padStart(4, "0")}`, 800 + i, (i % 5)],
    );
  }
  console.log(`seeded ${count} listings`);
}

/**
 * Walk every page and assert the walk terminates having seen each row exactly
 * once. Duplicates across pages are the other half of this bug: an unstable
 * ORDER BY makes rows shuffle between pages, so an infinite scroll shows the
 * same listing twice and never reaches the end.
 */
async function verify() {
  const seen = new Set<string>();
  const limit = 20;
  let offset = 0;
  let pages = 0;
  let total = -1;

  for (;;) {
    const rows = await query<{ id: string; total_count: string }>(
      `SELECT hl.id, COUNT(*) OVER() AS total_count
         FROM housing_listings hl
         JOIN users u ON u.id = hl.landlord_id
        WHERE hl.status = 'active' AND hl.title LIKE $1
        ORDER BY hl.rating DESC, hl.created_at DESC, hl.id DESC
        LIMIT $2 OFFSET $3`,
      [`${TAG}%`, limit, offset],
    );
    if (rows.length === 0) break;

    total = Number(rows[0].total_count);
    for (const r of rows) {
      if (seen.has(r.id)) throw new Error(`duplicate row across pages: ${r.id}`);
      seen.add(r.id);
    }

    pages++;
    offset += limit;
    if (pages > 1000) throw new Error("pagination did not terminate");
  }

  console.log(`walked ${pages} pages, ${seen.size} unique rows, total reported ${total}`);
  if (seen.size !== total) {
    throw new Error(`saw ${seen.size} rows but total said ${total}`);
  }
  if (seen.size <= 100) {
    throw new Error(`only ${seen.size} rows -- seed more than 100 or this proves nothing`);
  }
  console.log("✓ paged past 100 rows with no duplicates and no early stop");
}

async function cleanup() {
  const listings = await query<{ id: string }>(
    `DELETE FROM housing_listings WHERE title LIKE $1 RETURNING id`,
    [`${TAG}%`],
  );
  const users = await query<{ id: string }>(`DELETE FROM users WHERE email = $1 RETURNING id`, [
    FIXTURE_EMAIL,
  ]);
  console.log(`removed ${listings.length} listings, ${users.length} fixture users`);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is required -- this script talks to a real database");
    process.exit(1);
  }

  if (arg("cleanup")) await cleanup();
  else if (arg("verify")) await verify();
  else {
    await seed(Number(arg("count", "150")));
    await verify();
  }

  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
