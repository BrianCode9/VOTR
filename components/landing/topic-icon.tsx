import {
  Cpu,
  Globe2,
  GraduationCap,
  HeartPulse,
  Home,
  Leaf,
  LineChart,
  Receipt,
  Scale,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react"
import type { IconName } from "@/lib/landing/content"

/**
 * The one place icon names from the content layer turn into components.
 * Content stays JSON-safe; when it comes from an API, nothing here changes.
 */
const ICONS: Record<IconName, LucideIcon> = {
  home: Home,
  graduation: GraduationCap,
  "heart-pulse": HeartPulse,
  "line-chart": LineChart,
  cpu: Cpu,
  globe: Globe2,
  leaf: Leaf,
  scale: Scale,
  receipt: Receipt,
  shield: ShieldCheck,
}

export function TopicIcon({
  name,
  className,
}: {
  name: IconName
  className?: string
}) {
  const Icon = ICONS[name]
  return <Icon className={className} aria-hidden="true" />
}
