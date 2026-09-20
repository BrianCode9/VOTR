"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Menu, Search } from "lucide-react"
import { cn } from "cn"
import { VotrLogo } from "@/components/brand/votr-logo"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"

/**
 * Absolute, not "#trending".
 *
 * The nav now renders on the ballot, candidate and topic pages too, where
 * those sections do not exist. A bare fragment there is a link that visibly
 * does nothing, which is the failure this refactor is about.
 */
const LINKS = [
  { href: "/#featured", label: "Candidates" },
  { href: "/#local", label: "State" },
] as const

/**
 * `startHref` is resolved on the server and handed down, because this is a
 * Client Component and cannot read the location cookie itself.
 */
export function SiteNav({ startHref = "/#start" }: { startHref?: string }) {
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)

  // The bar starts borderless over the hero and gains a hairline plus blur
  // once content is behind it. Cheap, but it is the difference between a
  // header that sits on the page and one that floats above it.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  return (
    <header
      className={cn(
        "sticky top-0 z-50 transition-colors duration-300",
        scrolled
          ? "border-b border-hairline bg-sheet/85 backdrop-blur-md"
          : "border-b border-transparent bg-transparent"
      )}
    >
      <nav
        aria-label="Primary"
        className="mx-auto flex h-16 w-full max-w-6xl items-center gap-4 px-5 sm:h-18 sm:px-8"
      >
        <Link
          href="/"
          className="rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
        >
          <VotrLogo size="md" />
          <span className="sr-only">Votr home</span>
        </Link>

        <ul className="ml-4 hidden items-center gap-1 md:flex">
          {LINKS.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className="rounded-lg px-3 py-2 text-sm font-medium text-slate-ink transition-colors hover:bg-brand-tint hover:text-brand-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>

        <div className="ml-auto flex items-center gap-2">
          {/* Jumps to the real address lookup rather than pretending to be a
              live search field. */}
          <Link
            href={startHref}
            className="hidden items-center gap-2 rounded-full border border-hairline bg-sheet/70 py-2 pr-4 pl-3 text-sm text-slate-ink/80 transition-colors hover:border-brand/40 hover:text-navy focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand lg:inline-flex"
          >
            <Search className="size-4" aria-hidden="true" />
            Find your ballot
          </Link>

          <Button
            asChild
            size="lg"
            className="hidden h-10 rounded-full bg-navy px-4 text-white hover:bg-brand sm:inline-flex"
          >
            <Link href={startHref}>Explore your ballot</Link>
          </Button>

          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button
                variant="outline"
                size="icon-lg"
                className="rounded-full border-hairline md:hidden"
              >
                <Menu className="size-5" aria-hidden="true" />
                <span className="sr-only">Open menu</span>
              </Button>
            </SheetTrigger>

            <SheetContent side="right" className="w-[86vw] gap-0 sm:max-w-sm">
              <SheetHeader className="border-b border-hairline p-5">
                <SheetTitle asChild>
                  <span>
                    <VotrLogo size="sm" />
                  </span>
                </SheetTitle>
              </SheetHeader>

              <ul className="flex flex-col gap-1 p-3">
                {LINKS.map((link) => (
                  <li key={link.href}>
                    <SheetClose asChild>
                      <Link
                        href={link.href}
                        className="flex items-center justify-between rounded-xl px-3 py-3 font-heading text-lg font-medium text-navy transition-colors hover:bg-brand-tint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                      >
                        {link.label}
                      </Link>
                    </SheetClose>
                  </li>
                ))}
              </ul>

              <div className="mt-auto border-t border-hairline p-5">
                <SheetClose asChild>
                  <Button
                    asChild
                    size="lg"
                    className="h-11 w-full rounded-full bg-brand text-white hover:bg-brand-deep"
                  >
                    <Link href={startHref}>Explore your ballot</Link>
                  </Button>
                </SheetClose>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </nav>
    </header>
  )
}
