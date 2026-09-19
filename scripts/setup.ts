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

  // 2. Neon CLI, installed for you if absent
  let neonVersion = run("neon --version")
  if (!neonVersion) {
    console.log("  installing the neon CLI...")
    try {
      execSync("npm i -g neon@latest", { stdio: "inherit" })
      neonVersion = run("neon --version")
    } catch {
      bad("could not install the neon CLI")
      hint("macOS/Linux, if this was a permissions error: sudo npm i -g neon@latest")
      hint("or set a user-writable prefix: npm config set prefix ~/.npm-global")
      blocking++
    }
  }

  if (neonVersion) {
    ok(`neon CLI ${neonVersion}`)

    // `neon me` opens a browser when there is no stored credential, so it
    // doubles as the login step. stdio is inherited so the auth URL is
    // visible and the browser handshake can complete.
    let account = run("neon me")
    if (!account) {
      console.log("  signing you in to Neon, a browser window will open...")
      try {
        execSync("neon me", { stdio: "inherit" })
        account = run("neon me")
      } catch {
        // fall through to the failure below
      }
    }

    if (account) {
      const login = /Login\s+(\S+)/.exec(account)?.[1] ?? "ok"
      ok(`signed in to Neon as ${login}`)
    } else {
      bad("Neon sign-in did not complete")
      hint("run it directly and follow the browser prompt: neon login")
      blocking++
    }

    if (!existsSync(".neon")) {
      warn(".neon is missing, relinking")
      execSync("neon link --project-id cold-glade-81327185 --branch production -y", {
        stdio: "inherit",
      })
    }

    if (existsSync(".neon")) {
      const link = JSON.parse(readFileSync(".neon", "utf8"))
      ok(`project ${link.projectId}, branch ${link.branch}`)
    }

    if (run("neon env pull") !== null) {
      ok("pulled database credentials into .env.local")
    } else {
      bad("neon env pull failed")
      hint("This almost always means you are not in the Neon org yet.")
      hint("Ask Brian to invite you to org-nameless-credit-38867566, then re-run.")
      blocking++
    }
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

  // The team shares one set of keys. Nobody needs to make their own account.
  const keys: { name: string; fallback: string; needed: string }[] = [
    {
      name: "ANTHROPIC_API_KEY",
      fallback: "https://console.anthropic.com/settings/keys",
      needed: "extraction (npm run persist)",
    },
    {
      name: "NVIDIA_API_KEY",
      fallback: "https://build.nvidia.com  (a valid key starts with nvapi-)",
      needed: "Nemotron triage, judge, and the eval",
    },
    {
      name: "ELEVENLABS_API_KEY",
      fallback: "https://elevenlabs.io/app/settings/api-keys",
      needed: "transcription and audio briefings",
    },
  ]

  const missing: string[] = []
  console.log()
  for (const k of keys) {
    const v = process.env[k.name]
    if (v && v.length > 10) {
      ok(`${k.name} present`)
    } else {
      missing.push(k.name)
      warn(`${k.name} missing, needed for ${k.needed}`)
    }
  }

  if (missing.length > 0) {
    console.log()
    hint("These are SHARED across the team. Do not create your own accounts.")
    hint("Ask whoever set the project up to paste the block, then drop it into")
    hint(".env.local and re-run. Self-serve links, only if you truly need one:")
    for (const k of keys) {
      if (missing.includes(k.name)) hint(`  ${k.name}  ${k.fallback}`)
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
