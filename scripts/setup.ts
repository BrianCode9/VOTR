/**
 * One command that tells you exactly what is missing and how to fix it.
 *
 *   npm run setup
 *
 * Checks the Node version, pulls database credentials from Neon, reports which
 * API keys are absent with the link to get each one, and proves the database
 * and the Anthropic key actually work. Safe to re-run at any time.
 */

import { execSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"

const GREEN = "\x1b[32m"
const RED = "\x1b[31m"
const YELLOW = "\x1b[33m"
const DIM = "\x1b[2m"
const OFF = "\x1b[0m"

const ok = (m: string) => console.log(`${GREEN}✓${OFF} ${m}`)
const bad = (m: string) => console.log(`${RED}✗${OFF} ${m}`)
const warn = (m: string) => console.log(`${YELLOW}!${OFF} ${m}`)
const hint = (m: string) => console.log(`  ${DIM}${m}${OFF}`)

let blocking = 0

function run(cmd: string): string | null {
  try {
    return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim()
  } catch {
    return null
  }
}

async function main() {
  console.log("\nVOTR setup check\n")

  // 1. Node version
  const [major, minor] = process.versions.node.split(".").map(Number)
  if (major > 22 || (major === 22 && minor >= 20)) {
    ok(`Node ${process.versions.node}`)
  } else {
    bad(`Node ${process.versions.node} is too old, need 22.20.0 or newer`)
    hint("Windows: https://github.com/nvm-windows/nvm/releases then: nvm install lts")
    hint("macOS/Linux: nvm install --lts && nvm use --lts")
    blocking++
  }

  // 2. Neon CLI and project link
  const neonVersion = run("neon --version")
  if (neonVersion) {
    ok(`neon CLI ${neonVersion}`)
    if (existsSync(".neon")) {
      const link = JSON.parse(readFileSync(".neon", "utf8"))
      ok(`linked to project ${link.projectId} on branch ${link.branch}`)
      if (run("neon env pull") !== null) {
        ok("pulled database credentials into .env.local")
      } else {
        bad("neon env pull failed, you are probably not in the Neon org yet")
        hint("Ask the project owner to invite you, then run: neon login && neon env pull")
        blocking++
      }
    } else {
      warn(".neon is missing, relink with:")
      hint("neon link --project-id cold-glade-81327185 --branch production -y")
    }
  } else {
    bad("neon CLI not installed")
    hint("npm i -g neon@latest && neon login")
    blocking++
  }

  // 3. Env file
  if (!existsSync(".env.local")) {
    writeFileSync(
      ".env.local",
      "DATABASE_URL=\nANTHROPIC_API_KEY=\nNVIDIA_API_KEY=\nELEVENLABS_API_KEY=\n",
    )
    warn("created an empty .env.local")
  }
  process.loadEnvFile(".env.local")

  const keys: { name: string; where: string; needed: string }[] = [
    {
      name: "ANTHROPIC_API_KEY",
      where: "https://console.anthropic.com/settings/keys",
      needed: "extraction (npm run persist)",
    },
    {
      name: "NVIDIA_API_KEY",
      where: "https://build.nvidia.com  (key must start with nvapi-)",
      needed: "Nemotron triage, judge, and the eval",
    },
    {
      name: "ELEVENLABS_API_KEY",
      where: "https://elevenlabs.io/app/settings/api-keys",
      needed: "transcription and audio briefings",
    },
  ]

  console.log()
  for (const k of keys) {
    const v = process.env[k.name]
    if (v && v.length > 10) {
      ok(`${k.name} present`)
    } else {
      warn(`${k.name} missing, needed for ${k.needed}`)
      hint(`get one at ${k.where}`)
      hint(`then add it to .env.local`)
    }
  }

  // 4. Does the database actually answer
  console.log()
  if (process.env.DATABASE_URL) {
    try {
      const postgres = (await import("postgres")).default
      const sql = postgres(process.env.DATABASE_URL, { max: 1 })
      const [row] = await sql`
        select (select count(*) from documents) as docs,
               (select count(*) from insights) as insights
      `
      ok(`database reachable: ${row.docs} documents, ${row.insights} insights`)
      await sql.end()
      if (Number(row.insights) === 0) {
        hint("empty? run: npm run ingest   then: npm run persist")
      }
    } catch (e) {
      bad(`database unreachable: ${e instanceof Error ? e.message : String(e)}`)
      blocking++
    }
  } else {
    bad("DATABASE_URL is empty")
    blocking++
  }

  // 5. Does the Anthropic key actually work
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-opus-5",
          max_tokens: 8,
          messages: [{ role: "user", content: "hi" }],
        }),
      })
      if (res.ok) ok("Anthropic key works")
      else bad(`Anthropic key rejected: HTTP ${res.status}`)
    } catch {
      bad("could not reach the Anthropic API")
    }
  }

  // 6. NVIDIA: the models endpoint is public, so only inference proves a key
  if (process.env.NVIDIA_API_KEY) {
    try {
      const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
        method: "POST",
        headers: {
          authorization: `Bearer ${process.env.NVIDIA_API_KEY}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "nvidia/nemotron-nano-3-30b-a3b",
          max_tokens: 4,
          messages: [{ role: "user", content: "hi" }],
        }),
      })
      if (res.ok) ok("NVIDIA key works")
      else {
        bad(`NVIDIA key rejected: HTTP ${res.status}`)
        hint("note: /v1/models returns 200 with no key at all, so it proves nothing")
        hint("a working key starts with nvapi- and comes from build.nvidia.com")
      }
    } catch {
      bad("could not reach the NVIDIA API")
    }
  }

  console.log()
  if (blocking === 0) {
    ok("ready. run: npm run dev")
  } else {
    bad(`${blocking} thing${blocking === 1 ? "" : "s"} to fix above before npm run dev`)
  }
  console.log()
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
