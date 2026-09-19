import type { FactCheckStatus } from "./types"

/**
 * The seam where an external fact-checker plugs in.
 *
 * Nothing behind this interface is implemented yet, and the default provider
 * says so honestly by returning `unresolved` for everything. The interface
 * exists now rather than later for one reason: UNVERIFIED_CLAIM is assigned at
 * write time, so the pipeline has to have somewhere to ask, even when the
 * answer is always "nobody has checked". Wiring a real checker in later then
 * changes one registration call and no pipeline code.
 *
 * A provider is expected to be slow and allowed to fail. `checkClaim` below
 * enforces both: a throw or a timeout is an `unresolved` verdict, never an
 * exception that reaches the pipeline, because a fact-check outage must not be
 * able to stop insights from being stored.
 */

export interface FactCheckVerdict {
  status: FactCheckStatus
  /** Who said so. Stored on the insight, shown as provenance. */
  source: string
  /** Optional link to the published check, for a future "read the check" link. */
  url?: string
  /** The provider's own confidence, if it reports one. Not currently stored. */
  confidence?: number
}

export interface FactCheckProvider {
  /** Stable identifier, stored in insights.fact_check_source. */
  readonly name: string
  check(claimText: string): Promise<FactCheckVerdict>
}

/**
 * The default: everything is unresolved.
 *
 * This is not a stub in the sense of "incomplete". It is the correct provider
 * for a system with no fact-check integration, and it is what makes every
 * factual claim carry UNVERIFIED_CLAIM until one exists.
 */
export const unresolvedProvider: FactCheckProvider = {
  name: "unresolved",
  async check(): Promise<FactCheckVerdict> {
    return { status: "unresolved", source: "unresolved" }
  },
}

let active: FactCheckProvider = unresolvedProvider

/** Swap in a real checker. Returns the one being replaced, for tests. */
export function registerFactCheckProvider(
  provider: FactCheckProvider,
): FactCheckProvider {
  const previous = active
  active = provider
  return previous
}

export function currentFactCheckProvider(): FactCheckProvider {
  return active
}

/** How long a provider gets before the claim is treated as unresolved. */
export const FACT_CHECK_TIMEOUT_MS = 5_000

/**
 * Ask the active provider, and never let it break the caller.
 *
 * Failure, timeout, and a provider that returns nonsense all collapse to the
 * same `unresolved` verdict. The insight is stored either way; the only thing
 * that changes is whether it carries the UNVERIFIED_CLAIM badge, and when in
 * doubt it should.
 */
export async function checkClaim(
  claimText: string,
  options: { provider?: FactCheckProvider; timeoutMs?: number } = {},
): Promise<FactCheckVerdict> {
  const provider = options.provider ?? active
  const fallback: FactCheckVerdict = { status: "unresolved", source: provider.name }

  if (!claimText.trim()) return fallback

  try {
    const verdict = await withTimeout(
      provider.check(claimText),
      options.timeoutMs ?? FACT_CHECK_TIMEOUT_MS,
    )
    if (!verdict || typeof verdict.status !== "string") return fallback
    return { ...verdict, source: verdict.source || provider.name }
  } catch {
    return fallback
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("fact check timed out")), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}
