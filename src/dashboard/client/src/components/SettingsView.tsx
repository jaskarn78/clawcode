/**
 * Phase 116-postdeploy 2026-05-12 — Settings route (/dashboard/v2/settings).
 *
 * Wired to the Basic-mode "Settings" quick action and the Cmd+K
 * palette's "Settings" entry. v1 is intentionally lean — Theme + About
 * — so the route stops being a placeholder TODAY. Future surfaces
 * (cutover-redirect toggle, telemetry opt-in, default tier) can be added
 * here without needing another routing pass.
 *
 * dash-redesign sweep — retoned to the Mission Control design language.
 * Structural containers use the kit's `.tile` / `.section-head` /
 * `.tile-head` / `.tile-name` classes; inner typography uses the
 * Tailwind atoms that already map to the design tokens
 * (text-fg-1/-3, font-mono, font-display). mission-control.css is
 * imported globally at App.tsx so these classes resolve on every route.
 */
import type { JSX } from 'react'
import { ThemeToggle } from './ThemeToggle'

function readBuildInfo(): { readonly version: string; readonly buildId: string } {
  // Vite exposes import.meta.env.MODE; we keep this lean and string-only
  // for v1. When a future build wires a `__APP_VERSION__` define, this
  // function can pick it up — for now we surface the SPA mode + host.
  const mode = import.meta.env?.MODE ?? 'unknown'
  const buildId =
    typeof window !== 'undefined' && typeof window.location !== 'undefined'
      ? window.location.host
      : 'unknown'
  return { version: mode, buildId }
}

export function SettingsView(): JSX.Element {
  const build = readBuildInfo()
  return (
    <div
      className="mx-auto max-w-3xl px-7 py-8"
      data-testid="settings-view"
    >
      <div className="section-head mb-5">
        <div className="flex items-baseline">
          <h2>Settings</h2>
          <span className="sub">
            dashboard preferences · daemon config via{' '}
            <code className="font-mono text-fg-2">clawcode config</code>
          </span>
        </div>
      </div>

      <section className="tile mb-4">
        <div className="tile-head">
          <div className="tile-name">
            <h3>Theme</h3>
          </div>
          <span className="tile-model">clawcode:theme</span>
        </div>
        <p className="mt-3 mb-4 font-sans text-[13px] leading-relaxed text-fg-3">
          System-following, light, or dark. Persisted to local storage so
          the FOUC-guard in{' '}
          <code className="font-mono text-fg-2">index.html</code> paints
          the right palette before React hydrates.
        </p>
        <ThemeToggle />
      </section>

      <section className="tile mb-4">
        <div className="tile-head">
          <div className="tile-name">
            <h3>About</h3>
          </div>
        </div>
        <dl className="mt-3 grid gap-2 font-sans text-[13px]">
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-fg-3">Version</dt>
            <dd className="m-0 font-mono text-fg-1">{build.version}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-fg-3">Host</dt>
            <dd className="m-0 font-mono text-fg-1">{build.buildId}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-fg-3">Source</dt>
            <dd className="m-0">
              <a
                href="https://github.com/jjagpal/clawcode"
                target="_blank"
                rel="noreferrer noopener"
                className="font-mono text-primary no-underline hover:underline"
              >
                github.com/jjagpal/clawcode
              </a>
            </dd>
          </div>
        </dl>
      </section>

      <section className="tile" style={{ borderStyle: 'dashed', opacity: 0.85 }}>
        <div className="tile-head">
          <div className="tile-name">
            <h3 className="!text-fg-2">Coming soon</h3>
          </div>
        </div>
        <ul className="mt-3 grid gap-1.5 font-sans text-[13px] text-fg-3 list-none p-0">
          <li>· Dashboard cutover redirect toggle</li>
          <li>· Telemetry opt-in / opt-out</li>
          <li>· Default agent tier policy</li>
          <li>· Notification preferences</li>
        </ul>
        <p className="mt-4 font-sans text-[11.5px] leading-relaxed text-fg-3">
          These currently live in{' '}
          <code className="font-mono">~/.clawcode/config.yaml</code>. Move
          them here in a follow-up plan once the daemon-wide config IPC
          surface is settled.
        </p>
      </section>
    </div>
  )
}
