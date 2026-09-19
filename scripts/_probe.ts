process.loadEnvFile(".env.local")

async function main() {
  const postgres = (await import("postgres")).default
  const sql = postgres(process.env.DATABASE_URL_UNPOOLED!, { max: 1 })

  console.log("=== REAL candidates (have a candidate_sources row) ===")
  const real = await sql`
    select c.name, c.party, c.incumbent, r.office, r.level, d.state,
           cs.candidacy_status, cs.election_stage,
           left(coalesce(cs.biography,''), 70) bio, cs.campaign_website
    from candidates c
    join candidate_sources cs on cs.candidate_id = c.id
    join races r on r.id = c.race_id
    join districts d on d.id = r.district_id
    where cs.biography is not null
    order by r.level, r.office
    limit 12
  `
  for (const c of real) {
    console.log(`  ${c.name} | ${c.party ?? "no party"} | ${c.office} | ${c.level} | ${c.state}`)
    console.log(`      ${c.candidacy_status} | site=${c.campaign_website ? "yes" : "no"}`)
    console.log(`      bio: ${c.bio.replace(/\s+/g, " ")}…`)
  }

  console.log("\n=== party values present ===")
  const parties = await sql`
    select coalesce(c.party,'(null)') p, count(*) n
    from candidates c join candidate_sources cs on cs.candidate_id=c.id
    group by 1 order by 2 desc limit 12
  `
  console.log(" ", parties.map((r) => `${r.p}:${r.n}`).join("  "))

  console.log("\n=== offices with real candidates ===")
  const offices = await sql`
    select r.office, r.level, count(distinct c.id) n
    from candidates c join candidate_sources cs on cs.candidate_id=c.id
    join races r on r.id=c.race_id
    group by 1,2 order by 3 desc limit 14
  `
  for (const o of offices) console.log(`  ${o.office} (${o.level}): ${o.n}`)

  console.log("\n=== junk candidates (no source row) ===")
  const junk = await sql`
    select count(*) n from candidates c
    where not exists (select 1 from candidate_sources cs where cs.candidate_id=c.id)
  `
  console.log(`  ${junk[0].n} candidates have no source record`)

  console.log("\n=== insights attached to REAL candidates? ===")
  const linked = await sql`
    select count(*) n from insights i
    join candidate_sources cs on cs.candidate_id = i.candidate_id
  `
  console.log(`  ${linked[0].n} of 86 insights are on a sourced candidate`)

  await sql.end()
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })

export {}
