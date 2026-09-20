import type { IconName } from "@/lib/landing/content"

/**
 * Topic slug to icon.
 *
 * Extracted from lib/landing/queries.ts so the ballot pages and the landing
 * page cannot disagree about which glyph housing gets. A slug with no entry
 * falls back to the scales rather than rendering nothing.
 */
const TOPIC_ICONS: Record<string, IconName> = {
  housing: "home",
  education: "graduation",
  student_debt: "graduation",
  healthcare: "heart-pulse",
  reproductive_rights: "heart-pulse",
  economy: "line-chart",
  jobs_and_labor: "line-chart",
  technology_and_privacy: "cpu",
  immigration: "globe",
  foreign_policy: "globe",
  climate: "leaf",
  criminal_justice: "scale",
  voting_rights: "scale",
  taxes_and_budget: "receipt",
  transit_and_infrastructure: "receipt",
  public_safety: "shield",
  guns: "shield",
  veterans: "shield",
}

export function iconFor(slug: string): IconName {
  return TOPIC_ICONS[slug] ?? "scale"
}
