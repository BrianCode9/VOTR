/**
 * Seed the issue taxonomy and backfill topic tags on existing insights.
 *
 *   npm run seed:topics
 *   npm run seed:topics -- --no-backfill
 *
 * Run this after `npm run db:migrate`. Both halves are idempotent: the seed
 * upserts on slug, and the backfill only inserts join rows that are missing,
 * so running it twice changes nothing the second time.
 *
 * The taxonomy is data rather than schema, which is why it is seeded here
 * instead of in the migration. A new issue is a row someone adds, not a
 * deploy.
 */

process.loadEnvFile(".env.local")

async function main() {
  const args = process.argv.slice(2)
  const backfill = !args.includes("--no-backfill")

  const { seedTopics, invalidateTopicCache, loadTopics } = await import(
    "../lib/topics/taxonomy"
  )
  const { db } = await import("../db/index")
  const { sql } = await import("drizzle-orm")

  const { upserted } = await seedTopics()
  invalidateTopicCache()

  const topics = await loadTopics({ force: true })
  console.log(`taxonomy: ${upserted} seeded, ${topics.length} total in the table`)
  console.log(topics.map((t) => t.slug).join(", "))

  if (!backfill) return

  /*
   * Mirror each insight's primary issue_tag into insight_topics.
   *
   * The primary tag is the one guarantee every insight already has, so this is
   * what makes a topic filter see pre-existing rows. Insights written by the
   * pipeline from now on get their join rows at persist time, including any
   * secondary tags; those cannot be recovered for old rows without re-running
   * extraction, and the backfill does not pretend otherwise.
   */
  const inserted = await db.execute<{ [k: string]: unknown }>(sql`
    insert into insight_topics (insight_id, topic_id, "primary")
    select i.id, t.id, true
    from insights i
    join topics t on t.slug = i.issue_tag
    on conflict (insight_id, topic_id) do nothing
    returning insight_id
  `)

  const [{ orphans }] = [
    ...(await db.execute<{ [k: string]: unknown; orphans: number }>(sql`
      select count(*)::int as orphans
      from insights i
      where not exists (select 1 from insight_topics it where it.insight_id = i.id)
    `)),
  ]

  console.log(`\nbackfill: ${[...inserted].length} insight_topics rows written`)
  console.log(
    orphans === 0
      ? "every insight now resolves to at least one topic"
      : `WARNING: ${orphans} insight(s) carry an issue_tag with no matching topic row. ` +
          `Add the missing slugs to TOPIC_SEED in lib/topics/taxonomy.ts and re-run.`,
  )
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })

// Marks this file as a module: every script here declares a `main`, and
// without it they share one global scope.
export {}
