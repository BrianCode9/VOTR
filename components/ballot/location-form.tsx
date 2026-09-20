"use client"

import { useId, useState } from "react"
import { useFormStatus } from "react-dom"
import { Loader2, MapPin, Search } from "lucide-react"
import { cn } from "cn"
import { goToBallot } from "@/app/actions/location"
import { Button } from "@/components/ui/button"
import { STATES } from "@/lib/location/states"

/**
 * The entry point. Everything else in the product is downstream of this form.
 *
 * The state select is required and the address is not, which is the whole
 * design: a reader who will not type their home address into a website still
 * gets a real ballot, and a reader who will gets their congressional district
 * narrowed. There is no path through this form that ends nowhere.
 *
 * Posts to a Server Action rather than fetching an endpoint, so the geocoder
 * call, the cookie write and the navigation are one round trip and the address
 * never reaches the client bundle.
 */

export function LocationForm({
  /** States that actually have a ballot on file. Never offer a dead option. */
  available,
  defaultState,
  tone = "light",
  className,
}: {
  available: string[]
  defaultState?: string | null
  tone?: "light" | "dark"
  className?: string
}) {
  const stateId = useId()
  const addressId = useId()
  const [state, setState] = useState(defaultState ?? "")

  const offered = available.length > 0 ? available : STATES.map((s) => s.code)
  const states = STATES.filter((s) => offered.includes(s.code))
  const dark = tone === "dark"

  return (
    <form
      action={goToBallot}
      className={cn(
        "rounded-[1.5rem] border p-4 sm:p-5",
        dark ? "border-navy-line bg-navy-raised/80" : "border-hairline bg-sheet",
        className,
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="sm:w-[13.5rem]">
          <label
            htmlFor={stateId}
            className={cn(
              "font-mono text-[10px] tracking-[-0.01em]",
              dark ? "text-white/55" : "text-slate-ink/80",
            )}
          >
            Where you vote
          </label>

          <div className="relative mt-2">
            <MapPin
              className={cn(
                "pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2",
                dark ? "text-white/55" : "text-slate-ink/70",
              )}
              aria-hidden="true"
            />
            <select
              id={stateId}
              name="state"
              required
              value={state}
              onChange={(event) => setState(event.target.value)}
              className={cn(
                "h-12 w-full appearance-none rounded-full border pr-4 pl-10 text-sm transition-colors focus:outline-none focus-visible:ring-2",
                dark
                  ? "border-white/15 bg-navy text-white hover:border-white/30 focus:border-brand-bright focus-visible:ring-brand-bright/40"
                  : "border-hairline bg-mist text-navy hover:border-brand/40 focus:border-brand focus-visible:ring-brand/30",
              )}
            >
              <option value="" disabled>
                Choose your state
              </option>
              {states.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex-1">
          <label
            htmlFor={addressId}
            className={cn(
              "font-mono text-[10px] tracking-[-0.01em]",
              dark ? "text-white/55" : "text-slate-ink/80",
            )}
          >
            Street address <span className="opacity-70">— optional, narrows to your district</span>
          </label>

          <div className="relative mt-2">
            <Search
              className={cn(
                "pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2",
                dark ? "text-white/55" : "text-slate-ink/70",
              )}
              aria-hidden="true"
            />
            <input
              id={addressId}
              name="address"
              type="text"
              autoComplete="street-address"
              placeholder="123 Main St, Houston, TX 77002"
              className={cn(
                "h-12 w-full rounded-full border pr-4 pl-10 text-sm transition-colors focus:outline-none focus-visible:ring-2",
                dark
                  ? "border-white/15 bg-sheet/[0.04] text-white placeholder:text-white/45 hover:border-white/30 focus:border-brand-bright focus-visible:ring-brand-bright/40"
                  : "border-hairline bg-mist text-navy placeholder:text-slate-ink/50 hover:border-brand/40 focus:border-brand focus-visible:ring-brand/30",
              )}
            />
          </div>
        </div>

        <SubmitButton dark={dark} />
      </div>

      <p
        className={cn(
          "mt-3 font-mono text-[10px] leading-relaxed",
          dark ? "text-white/45" : "text-slate-ink/70",
        )}
      >
        Your address is sent to the US Census geocoder to find your district and
        is never stored. Only the state and district number are kept, on this
        device.
      </p>
    </form>
  )
}

/**
 * Its own component because useFormStatus only reports the status of a form
 * above it in the tree, not one rendered by the same component.
 */
function SubmitButton({ dark }: { dark: boolean }) {
  const { pending } = useFormStatus()

  return (
    <Button
      type="submit"
      size="lg"
      disabled={pending}
      className={cn(
        "h-12 shrink-0 rounded-full px-6 text-base",
        dark
          ? "bg-sheet text-navy hover:bg-brand-bright hover:text-white"
          : "bg-brand text-white shadow-[0_12px_30px_-12px_var(--color-brand)] hover:bg-brand-deep",
      )}
    >
      {pending ? (
        <>
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Finding your ballot
        </>
      ) : (
        "See who's running"
      )}
    </Button>
  )
}
