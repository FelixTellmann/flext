import { createFileRoute, useRouter } from "@tanstack/react-router";
import clsx from "clsx";
import { useState } from "react";
import { orpc } from "~/integrations/orpc";
import { ActionButton, accent_button, busy_state, field, Panel, Spinner, secondary_button } from "./-ui";

type ObservedCertificate = {
  spki_sha256: string;
  issuer: string;
  subject: string;
  valid_from: string;
  valid_to: string;
  subject_alt_names: string[];
};

type ObservedAddress = {
  address: string;
  source_header: string;
  occurrences: number;
  last_seen_at: string | null;
};

export const Route = createFileRoute("/admin/mail")({
  loader: async () => {
    const [mailboxes, runs] = await Promise.all([orpc.mail.listMailboxes(), orpc.mail.listSyncRuns({ limit: 20 })]);
    return { mailboxes, runs };
  },
  component: AdminMailPage,
});

const checkbox =
  "h-4 w-4 rounded border-gray-300 text-accent focus-visible:ring-2 focus-visible:ring-info dark:border-dark-border dark:bg-dark-bg";

function AdminMailPage() {
  const { mailboxes, runs } = Route.useLoaderData();
  const router = useRouter();
  const [status, setStatus] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [certificate, setCertificate] = useState<ObservedCertificate | null>(null);
  const [certificate_target, setCertificateTarget] = useState<string | null>(null);
  const [observed_addresses, setObservedAddresses] = useState<Record<string, ObservedAddress[]>>({});
  const [selected_addresses, setSelectedAddresses] = useState<Record<string, Set<string>>>({});
  const [picker_open, setPickerOpen] = useState<Record<string, boolean>>({});
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
              label={picker_open[entry.id] === true ? "Hide observed addresses" : "Review observed addresses"}
              onClick={() => {
                if (picker_open[entry.id] === true) {
                  setPickerOpen({ ...picker_open, [entry.id]: false });
                  return;
                }
                void runAction(`${entry.id}:observed`, "Load observed addresses", async () => {
                  const rows = await orpc.mail.listObservedAddresses({ id: entry.id });
                  const rows_by_address = new Set(rows.map((row) => row.address));
                  setObservedAddresses((previous) => ({ ...previous, [entry.id]: rows }));
                  setSelectedAddresses((previous) => ({
                    ...previous,
                    [entry.id]: new Set(entry.identity_addresses.filter((address) => rows_by_address.has(address))),
                  }));
                  setPickerOpen((previous) => ({ ...previous, [entry.id]: true }));
                  return `${rows.length} addresses`;
                });
              }}
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

          {picker_open[entry.id] === true && observed_addresses[entry.id] !== undefined && (
            <div className="mt-3 rounded border border-gray-200 p-3 dark:border-dark-border">
              <p className="mb-2 text-gray-600 text-sm dark:text-dark-text">
                Tick every address that genuinely belongs to this operator. Saving only changes how new mail is classified — messages
                already synced keep their current to_me value until a reclassify sync run recomputes them.
              </p>
              {observed_addresses[entry.id]?.length === 0 ? (
                <p className="text-gray-500 text-sm dark:text-dark-text">No observed addresses yet.</p>
              ) : (
                <ul className="mb-3 flex max-h-64 flex-col gap-1 overflow-y-auto">
                  {observed_addresses[entry.id]?.map((row) => {
                    const input_id = `${entry.id}-observed-${row.address}`;
                    return (
                      <li className="flex items-center gap-2 text-sm" key={row.address}>
                        <input
                          checked={selected_addresses[entry.id]?.has(row.address) ?? false}
                          className={checkbox}
                          id={input_id}
                          onChange={(event) => {
                            setSelectedAddresses((previous) => {
                              const next = new Set(previous[entry.id] ?? []);
                              if (event.target.checked) {
                                next.add(row.address);
                              } else {
                                next.delete(row.address);
                              }
                              return { ...previous, [entry.id]: next };
                            });
                          }}
                          type="checkbox"
                        />
                        <label className="flex-1 cursor-pointer" htmlFor={input_id}>
                          {row.address}{" "}
                          <span className="text-gray-500 dark:text-dark-text">
                            ({row.source_header} ×{row.occurrences})
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
              <ActionButton
                busy={pending === `${entry.id}:save-identity`}
                disabled={pending !== null}
                label="Save identity addresses"
                onClick={() =>
                  void runAction(`${entry.id}:save-identity`, "Save identity addresses", async () => {
                    const rows_by_address = new Set((observed_addresses[entry.id] ?? []).map((row) => row.address));
                    const kept_addresses = entry.identity_addresses.filter((address) => !rows_by_address.has(address));
                    const addresses = [...kept_addresses, ...Array.from(selected_addresses[entry.id] ?? [])];
                    await orpc.mail.setIdentityAddresses({ id: entry.id, addresses });
                    return "Saved. New mail uses this list immediately — run reclassify to correct existing messages' to_me value.";
                  })
                }
                variant={accent_button}
              />
            </div>
          )}

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
