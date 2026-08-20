import { describe, expect, test } from "bun:test";
import type { CreateFilingResolverInput } from "@server/mail/filing/resolver";
import { createFilingResolver } from "@server/mail/filing/resolver";
import type { FolderInfo, MailboxProvider } from "@server/mail/providers/types";

// felix@tellmann.co.za's real shape: dot-delimited, thirteen hand-built folders under "INBOX.", two of
// them named nothing a rendered path would ever produce.
const TELLMANN_FOLDERS: FolderInfo[] = [
  { path: "INBOX", delimiter: ".", special_use: null, subscribed: true, selectable: true },
  { path: "INBOX.KidsLiving", delimiter: ".", special_use: null, subscribed: true, selectable: true },
  { path: "INBOX.Finances - Ref", delimiter: ".", special_use: null, subscribed: true, selectable: true },
];

// A Gmail mailbox's real shape: slash-delimited, no user labels at all, so every filed path renders
// fresh and is created on first use.
const GMAIL_FOLDERS: FolderInfo[] = [
  { path: "INBOX", delimiter: "/", special_use: null, subscribed: true, selectable: true },
  { path: "[Gmail]/All Mail", delimiter: "/", special_use: "\\All", subscribed: true, selectable: true },
];

function unsupported(name: string): never {
  throw new Error(`${name} is not part of this fixture`);
}

function createFakeProvider(input: { folders: FolderInfo[]; events: string[] }): MailboxProvider {
  const { folders, events } = input;
  let list_folders_calls = 0;

  return {
    capabilities: { condstore: false, qresync: false, uidplus: false, move: false, gmail: false },

    listFolders: async () => {
      list_folders_calls += 1;
      events.push(`list_folders:${list_folders_calls}`);
      return folders;
    },

    createFolder: async (folder: string) => {
      events.push(`create_folder:${folder}`);
    },

    openFolder: () => unsupported("openFolder"),
    fetchHeaders: () => unsupported("fetchHeaders"),
    fetchIdentities: () => unsupported("fetchIdentities"),
    fetchFlagChanges: () => unsupported("fetchFlagChanges"),
    listUids: () => unsupported("listUids"),
    moveMessages: () => unsupported("moveMessages"),
    setLabels: () => unsupported("setLabels"),
    disconnect: () => unsupported("disconnect"),
  };
}

function resolverInput(input: {
  folders: FolderInfo[];
  events: string[];
  delimiter: string;
  bindings?: readonly { logical_path: string; folder: string }[];
}): CreateFilingResolverInput {
  return {
    provider: createFakeProvider({ folders: input.folders, events: input.events }),
    bindings: input.bindings ?? [],
    delimiter: input.delimiter,
  };
}

describe("createFilingResolver", () => {
  test("a bound path returns the bound folder verbatim and issues no createFolder", async () => {
    const events: string[] = [];
    const resolver = await createFilingResolver(
      resolverInput({
        folders: TELLMANN_FOLDERS,
        events,
        delimiter: ".",
        bindings: [{ logical_path: "Finances", folder: "INBOX.Finances - Ref" }],
      }),
    );

    const resolved = await resolver.resolve("Finances");

    expect(resolved).toBe("INBOX.Finances - Ref");
    expect(events.filter((event) => event.startsWith("create_folder"))).toEqual([]);
  });

  test("an unbound path renders and creates exactly once", async () => {
    const events: string[] = [];
    const resolver = await createFilingResolver(resolverInput({ folders: GMAIL_FOLDERS, events, delimiter: "/" }));

    const resolved = await resolver.resolve("Clients/Acme");

    expect(resolved).toBe("Clients/Acme");
    expect(events.filter((event) => event.startsWith("create_folder"))).toEqual(["create_folder:Clients/Acme"]);
  });

  test("resolving the same path twice issues exactly one createFolder", async () => {
    const events: string[] = [];
    const resolver = await createFilingResolver(resolverInput({ folders: GMAIL_FOLDERS, events, delimiter: "/" }));

    const first = await resolver.resolve("Clients/Acme");
    const second = await resolver.resolve("Clients/Acme");

    expect(first).toBe("Clients/Acme");
    expect(second).toBe("Clients/Acme");
    expect(events.filter((event) => event.startsWith("create_folder"))).toEqual(["create_folder:Clients/Acme"]);
  });

  test("an unbound path the server already lists issues no createFolder", async () => {
    const events: string[] = [];
    const resolver = await createFilingResolver(resolverInput({ folders: TELLMANN_FOLDERS, events, delimiter: "." }));

    const resolved = await resolver.resolve("KidsLiving");

    expect(resolved).toBe("INBOX.KidsLiving");
    expect(events.filter((event) => event.startsWith("create_folder"))).toEqual([]);
  });

  test("listFolders is called exactly once for the resolver's whole lifetime", async () => {
    const events: string[] = [];
    const resolver = await createFilingResolver(
      resolverInput({
        folders: TELLMANN_FOLDERS,
        events,
        delimiter: ".",
        bindings: [{ logical_path: "Finances", folder: "INBOX.Finances - Ref" }],
      }),
    );

    await resolver.resolve("Finances");
    await resolver.resolve("KidsLiving");
    await resolver.resolve("Ops/Shopify");
    await resolver.resolve("Ops/Shopify");

    expect(events.filter((event) => event.startsWith("list_folders"))).toEqual(["list_folders:1"]);
  });
});

describe("resolveWithoutCreating", () => {
  test("renders an unlisted path and creates nothing", async () => {
    const events: string[] = [];
    const resolver = await createFilingResolver(resolverInput({ folders: GMAIL_FOLDERS, events, delimiter: "/" }));

    expect(resolver.resolveWithoutCreating("Clients/Acme")).toBe("Clients/Acme");
    expect(events.filter((event) => event.startsWith("create_folder"))).toEqual([]);
  });

  test("returns a binding verbatim, exactly as resolve does", async () => {
    const events: string[] = [];
    const resolver = await createFilingResolver(
      resolverInput({
        folders: TELLMANN_FOLDERS,
        events,
        delimiter: ".",
        bindings: [{ logical_path: "Finances", folder: "INBOX.Finances - Ref" }],
      }),
    );

    // The two resolutions may only differ about whether they are allowed to create, never about where a
    // logical path lives.
    expect(resolver.resolveWithoutCreating("Finances")).toBe("INBOX.Finances - Ref");
    expect(await resolver.resolve("Finances")).toBe("INBOX.Finances - Ref");
    expect(events.filter((event) => event.startsWith("create_folder"))).toEqual([]);
  });

  test("refuses a segment carrying the server's delimiter, rather than creating hierarchy", async () => {
    const events: string[] = [];
    const resolver = await createFilingResolver(resolverInput({ folders: TELLMANN_FOLDERS, events, delimiter: "." }));

    expect(() => resolver.resolveWithoutCreating("Ops.Shopify")).toThrow("hierarchy delimiter");
    expect(events.filter((event) => event.startsWith("create_folder"))).toEqual([]);
  });
});
