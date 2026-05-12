/**
 * Phase 116-postdeploy 2026-05-12 — Settings route (/dashboard/v2/settings).
 *
 * Wired to the Basic-mode "Settings" quick action and the Cmd+K
 * palette's "Settings" entry. v1 is intentionally lean — Theme + About
 * — so the route stops being a placeholder TODAY. Future surfaces
 * (cutover-redirect toggle, telemetry opt-in, default tier) can be added
 * here without needing another routing pass.
 *
 * Notably absent in v1:
 *   - `defaults.dashboardCutoverRedirect` toggle. Requires a new daemon
 *     IPC for daemon-wide defaults (`update-agent-config` is agent-scoped;
 *     there is no daemon-wide setter today). Deferred to a follow-up plan
 *     so this PR ships the three button wires without scope creep.
 */
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
      className="mx-auto max-w-3xl px-4 py-8 lg:px-6"
      data-testid="settings-view"
    >
      <header className="mb-8">
        <h1 className="font-display text-3xl font-bold tracking-tight text-fg-1">
          Settings
        </h1>
        <p className="mt-1 text-sm text-fg-3">
          Dashboard preferences. Daemon-side config (agent models, tier
          policy, cutover flags) is still edited via{' '}
          <code className="font-mono text-fg-2">clawcode config</code>.
        </p>
      </header>

      <section className="mb-8 rounded-lg border border-border bg-bg-elevated p-5">
        <h2 className="mb-1 font-display text-lg font-medium text-fg-1">
          Theme
        </h2>
        <p className="mb-3 text-sm text-fg-3">
          Choose between system-following, light, or dark. Persisted in
          local storage under{' '}
          <code className="font-mono text-fg-2">clawcode:theme</code> so
          the FOUC-guard in <code className="font-mono text-fg-2">index.html</code>
          {' '}
          can paint the right palette before React hydrates.
        </p>
        <div className="rounded-md border border-border bg-bg-base p-3">
          <ThemeToggle />
        </div>
      </section>

      <section className="mb-8 rounded-lg border border-border bg-bg-elevated p-5">
        <h2 className="mb-3 font-display text-lg font-medium text-fg-1">
          About
        </h2>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-fg-3">Version</dt>
            <dd className="font-mono text-fg-1">{build.version}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-fg-3">Host</dt>
            <dd className="font-mono text-fg-1">{build.buildId}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-fg-3">Source</dt>
            <dd>
              <a
                href="https://github.com/jjagpal/clawcode"
                target="_blank"
                rel="noreferrer noopener"
                className="font-mono text-primary hover:underline"
              >
                github.com/jjagpal/clawcode
              </a>
            </dd>
          </div>
        </dl>
      </section>

      <section className="rounded-lg border border-dashed border-border bg-bg-elevated/40 p-5">
        <h2 className="mb-2 font-display text-base font-medium text-fg-2">
          Coming soon
        </h2>
        <ul className="space-y-1 text-sm text-fg-3">
          <li>· Dashboard cutover redirect toggle</li>
          <li>· Telemetry opt-in / opt-out</li>
          <li>· Default agent tier policy</li>
          <li>· Notification preferences</li>
        </ul>
        <p className="mt-3 text-xs text-fg-3">
          These currently live in <code className="font-mono">~/.clawcode/config.yaml</code>.
          Move them here in a follow-up plan once the daemon-wide config
          IPC surface is settled.
        </p>
      </section>
    </div>
  )
}
