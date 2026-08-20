import { describe, expect, test } from "bun:test";
import { findNamespaceRoot, renderFolderPath } from "@server/mail/filing/render";
import type { FolderInfo } from "@server/mail/providers/types";

function folder(path: string): FolderInfo {
  return { path, delimiter: ".", special_use: null, subscribed: true, selectable: true };
}

describe("findNamespaceRoot", () => {
  test("returns INBOX when every folder is INBOX-rooted, as on felix@tellmann.co.za", () => {
    const folders = [folder("INBOX"), folder("INBOX.Sent"), folder("INBOX.KidsLiving"), folder("INBOX.Finances - Ref")];
    expect(findNamespaceRoot(folders, ".")).toBe("INBOX");
  });

  test("returns null when a folder lives outside INBOX, as on Gmail", () => {
    const folders = [folder("INBOX"), folder("[Gmail]/All Mail")];
    expect(findNamespaceRoot(folders, "/")).toBeNull();
  });

  test("ignores unselectable folders", () => {
    const folders = [folder("INBOX"), folder("INBOX.KidsLiving"), { ...folder("[Gmail]"), selectable: false }];
    expect(findNamespaceRoot(folders, ".")).toBe("INBOX");
  });

  test("refuses an empty folder list rather than guessing", () => {
    expect(() => findNamespaceRoot([], ".")).toThrow(/no selectable folders/);
  });
});

describe("renderFolderPath", () => {
  test("renders with the server's delimiter under its namespace root", () => {
    expect(renderFolderPath({ logical_path: "Clients/KidsLiving", delimiter: ".", namespace_root: "INBOX" })).toBe(
      "INBOX.Clients.KidsLiving",
    );
  });

  test("renders at the top level when there is no namespace root", () => {
    expect(renderFolderPath({ logical_path: "Clients/KidsLiving", delimiter: "/", namespace_root: null })).toBe("Clients/KidsLiving");
  });

  test("never emits a literal slash on a dot-delimited server", () => {
    const rendered = renderFolderPath({ logical_path: "Ops/Shopify", delimiter: ".", namespace_root: "INBOX" });
    expect(rendered).not.toContain("/");
  });

  test("refuses a segment carrying the server's own delimiter", () => {
    expect(() => renderFolderPath({ logical_path: "Finances - Ref/A.B", delimiter: ".", namespace_root: "INBOX" })).toThrow(
      /hierarchy delimiter/,
    );
  });

  test("refuses an empty delimiter", () => {
    expect(() => renderFolderPath({ logical_path: "Finances", delimiter: "", namespace_root: null })).toThrow(/no hierarchy delimiter/);
  });
});
