import { createFileRoute, useRouter } from "@tanstack/react-router";
import clsx from "clsx";
import { type FC, type ReactNode, useState } from "react";
import { orpc } from "~/integrations/orpc";

type ObservedCertificate = {
  spki_sha256: string;
  issuer: string;
  subject: string;
  valid_from: string;
  valid_to: string;
  subject_alt_names: string[];
};

export const Route = createFileRoute("/admin/mail")({
  loader: async () => {
    const [mailboxes, runs] = await Promise.all([orpc.mail.listMailboxes(), orpc.mail.listSyncRuns({ limit: 20 })]);
    return { mailboxes, runs };
  },
  component: AdminMailPage,
});

const Panel: FC<{ title: string; children: ReactNode }> = ({ title, children }) => (
  <section className="rounded-lg border border-gray-200 bg-card p-4 dark:border-dark-border dark:bg-dark-card">
    <h2 className="mb-3 font-semibold text-gray-900 text-sm dark:text-dark-headings">{title}</h2>
    {children}
  </section>
);

// --color-accent and --color-accent-contrast hold the same RGB, so the token pair renders invisible text.
// Same workaround as the sign-in button until the design-system gap is closed.
const accent_button = "rounded bg-accent px-3 py-2 font-medium text-sm text-white dark:bg-accent-dark dark:text-dark-bg";
const field = "rounded border border-gray-300 p-2 text-sm dark:border-dark-border dark:bg-dark-bg";
const secondary_button = "rounded border border-gray-300 px-3 py-1 text-sm dark:border-dark-border";
const busy_state = "inline-flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-50";

const Spinner: FC = () => (
  <svg aria-hidden="true" className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-75" d="M4 12a8 8 0 0 1 8-8" stroke="currentColor" strokeLinecap="round" strokeWidth="4" />
  </svg>
);

// A backfill can hold the request open for minutes, so a button that still looks clickable is the whole
// problem: every action disables the entire set, and the one that is working says so.
const ActionButton: FC<{
  busy: boolean;
  disabled: boolean;
  label: string;
  onClick: () => void;
  variant: string;
}> = ({ busy, disabled, label, onClick, variant }) => (
  <button className={clsx(variant, busy_state)} disabled={disabled} onClick={onClick} type="button">
    {busy && <Spinner />}
    {busy ? `${label}…` : label}
  </button>
);

function AdminMailPage() {
  const { mailboxes, runs } = Route.useLoaderData();
  const router = useRouter();
  const [status, setStatus] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [certificate, setCertificate] = useState<ObservedCertificate | null>(null);
  const [certificate_target, setCertificateTarget] = useState<string | null>(null);
  const [form, setForm] = useState({
    label: "",
    host: "",
    port: 993,
    username: "",
    password: "",
    flavor: "generic" as "gmail" | "generic",
    identity_addresses: "",
  });

  const runAction = async (key: string, label: string, action: () => Promise<unknown>) => {
    setPending(key);
    setStatus(`${label}…`);
    try {
      const result = await action();
      setStatus(`${label}: ${JSON.stringify(result)}`);
      await router.invalidate();
    } catch (error) {
      setStatus(`${label} failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
      <h1 className="font-bold text-gray-900 text-xl dark:text-dark-headings">Mail — connect &amp; sync</h1>

      {status !== null && <p className="rounded border border-info/40 bg-info/10 p-3 text-sm">{status}</p>}

      <Panel title="Add a mailbox">
        <form
          className="grid grid-cols-2 gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void runAction("add", "Add mailbox", () =>
              orpc.mail.addMailbox({
                label: form.label,
                host: form.host,
                port: form.port,
                username: form.username,
                password: form.password,
                flavor: form.flavor,
                identity_addresses: form.identity_addresses
                  .split(",")
                  .map((entry) => entry.trim())
                  .filter((entry) => entry.length > 0),
              }),
            );
          }}
        >
          <input
            className={field}
            onChange={(event) => setForm({ ...form, label: event.target.value })}
            placeholder="Label"
            required
            value={form.label}
          />
          <input
            className={field}
            onChange={(event) => setForm({ ...form, host: event.target.value })}
            placeholder="imap.gmail.com"
            required
            value={form.host}
          />
          <input
            className={field}
            onChange={(event) => setForm({ ...form, port: Number(event.target.value) })}
            placeholder="993"
            type="number"
            value={form.port}
          />
          <select
            className={field}
            onChange={(event) => setForm({ ...form, flavor: event.target.value === "gmail" ? "gmail" : "generic" })}
            value={form.flavor}
          >
            <option value="generic">generic</option>
            <option value="gmail">gmail</option>
          </select>
          <input
            className={field}
            onChange={(event) => setForm({ ...form, username: event.target.value })}
            placeholder="Username"
            required
            value={form.username}
          />
          <input
            className={field}
            onChange={(event) => setForm({ ...form, password: event.target.value })}
            placeholder="App password"
            required
            type="password"
            value={form.password}
          />
          <input
            className={`col-span-2 ${field}`}
            onChange={(event) => setForm({ ...form, identity_addresses: event.target.value })}
            placeholder="Identity addresses, comma separated (felix@flext.dev, *@flext.dev)"
            value={form.identity_addresses}
          />
          <button className={clsx("col-span-2", accent_button, busy_state)} disabled={pending !== null} type="submit">
            {pending === "add" && <Spinner />}
            {pending === "add" ? "Adding mailbox…" : "Add mailbox"}
          </button>
        </form>
      </Panel>

      {mailboxes.map((entry) => (
        <Panel key={entry.id} title={`${entry.label} — ${entry.username}@${entry.host}`}>
          <dl className="mb-3 grid grid-cols-2 gap-1 text-gray-600 text-sm dark:text-dark-text">
            <dt>Flavor / TLS</dt>
            <dd>
              {entry.flavor} / {entry.tls_policy}
            </dd>
            <dt>Canonical folder</dt>
            <dd>{entry.canonical_folder ?? "—"}</dd>
            <dt>Delimiter</dt>
            <dd>{entry.hierarchy_delimiter ?? "—"}</dd>
            <dt>Identity addresses</dt>
            <dd>{entry.identity_addresses.join(", ") || "none yet"}</dd>
            <dt>Backfilled</dt>
            <dd>{entry.backfilled_at ?? "never"}</dd>
            <dt>Enabled</dt>
            <dd>{entry.enabled ? "yes" : "no"}</dd>
          </dl>

          {entry.last_error !== null && <p className="mb-3 rounded bg-danger/10 p-2 text-danger text-sm">{entry.last_error}</p>}

          <div className="flex flex-wrap gap-2">
            <ActionButton
              busy={pending === `${entry.id}:test`}
              disabled={pending !== null}
              label="Test connection"
              onClick={() => void runAction(`${entry.id}:test`, "Test connection", () => orpc.mail.testConnection({ id: entry.id }))}
              variant={secondary_button}
            />
            <ActionButton
              busy={pending === `${entry.id}:backfill`}
              disabled={pending !== null}
              label="Backfill"
              onClick={() =>
                void runAction(`${entry.id}:backfill`, "Backfill", () => orpc.mail.triggerSync({ mode: "backfill", mailbox_id: entry.id }))
              }
              variant={secondary_button}
            />
            <ActionButton
              busy={pending === `${entry.id}:sync`}
              disabled={pending !== null}
              label="Sync now"
              onClick={() =>
                void runAction(`${entry.id}:sync`, "Sync", () => orpc.mail.triggerSync({ mode: "incremental", mailbox_id: entry.id }))
              }
              variant={secondary_button}
            />
            <ActionButton
              busy={pending === `${entry.id}:observed`}
              disabled={pending !== null}
              label="Show observed Delivered-To"
              onClick={() =>
                void runAction(`${entry.id}:observed`, "Observed addresses", async () => {
                  const observed = await orpc.mail.listObservedAddresses({ id: entry.id });
                  return observed.map((row) => `${row.address} (${row.source_header} ×${row.occurrences})`);
                })
              }
              variant={secondary_button}
            />
            <ActionButton
              busy={pending === `${entry.id}:cert`}
              disabled={pending !== null}
              label="Inspect certificate"
              onClick={() =>
                void runAction(`${entry.id}:cert`, "Inspect certificate", async () => {
                  const observed = await orpc.mail.inspectCertificate({ host: entry.host, port: entry.port });
                  setCertificate(observed);
                  setCertificateTarget(entry.id);
                  return observed.spki_sha256;
                })
              }
              variant="rounded border border-warning px-3 py-1 text-sm text-warning"
            />
          </div>

          {certificate !== null && certificate_target === entry.id && (
            <div className="mt-3 rounded border border-warning/50 bg-warning/10 p-3 text-sm">
              <p className="mb-2 font-medium">
                A routine key rotation and a MITM look identical on the wire — compare both sides before confirming.
              </p>
              <dl className="grid grid-cols-2 gap-1">
                <dt>Pinned now</dt>
                <dd>{entry.pinned_spki.join(", ") || "nothing pinned"}</dd>
                <dt>Presented SPKI</dt>
                <dd>{certificate.spki_sha256}</dd>
                <dt>Issuer</dt>
                <dd>{certificate.issuer}</dd>
                <dt>Subject</dt>
                <dd>{certificate.subject}</dd>
                <dt>Valid</dt>
                <dd>
                  {certificate.valid_from} → {certificate.valid_to}
                </dd>
                <dt>SANs</dt>
                <dd>{certificate.subject_alt_names.join(", ") || "—"}</dd>
              </dl>
              <div className="mt-3 flex gap-2">
                <ActionButton
                  busy={pending === `${entry.id}:pin-add`}
                  disabled={pending !== null}
                  label="Add to pinned set"
                  onClick={() =>
                    void runAction(`${entry.id}:pin-add`, "Stage pin", () =>
                      orpc.mail.repinMailbox({ id: entry.id, spki_sha256: certificate.spki_sha256, replace: false }),
                    )
                  }
                  variant={accent_button}
                />
                <ActionButton
                  busy={pending === `${entry.id}:pin-replace`}
                  disabled={pending !== null}
                  label="Replace pinned set"
                  onClick={() =>
                    void runAction(`${entry.id}:pin-replace`, "Replace pin", () =>
                      orpc.mail.repinMailbox({ id: entry.id, spki_sha256: certificate.spki_sha256, replace: true }),
                    )
                  }
                  variant="rounded border border-danger px-3 py-1 text-danger text-sm"
                />
              </div>
            </div>
          )}
        </Panel>
      ))}

      <Panel title="Recent sync runs">
        <ul className="flex flex-col gap-1 text-gray-600 text-sm dark:text-dark-text">
          {runs.map((run) => (
            <li key={run.id}>
              {run.started_at} · {run.kind} · {run.status} · +{run.messages_new} new · {run.messages_vanished} vanished
              {run.error_message === null ? "" : ` · ${run.error_message}`}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
