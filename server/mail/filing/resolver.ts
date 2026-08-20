import { findNamespaceRoot, renderFolderPath } from "@server/mail/filing/render";
import type { FolderInfo, MailboxProvider } from "@server/mail/providers/types";

export type FilingResolver = {
  resolve: (logical_path: string) => Promise<string>;
};

export type CreateFilingResolverInput = {
  provider: MailboxProvider;
  bindings: readonly { logical_path: string; folder: string }[];
  delimiter: string;
};

// Resolution order, and the reason for it:
//
//   1. a binding, which is the operator saying "this logical path already has a home". Returned verbatim
//      and never re-rendered: "INBOX.Finances - Ref" is a folder that exists with 99 messages in it, and
//      re-deriving it from segments would produce "INBOX.Finances - Ref" only by luck.
//   2. otherwise render from the logical segments with this server's delimiter and namespace.
//   3. create it if the server did not already list it.
//
// The folder list is read once per run, and every resolution is memoised — filing a batch of 400
// messages into one client folder issues at most one CREATE, and re-filing into a folder created earlier
// in the same run issues none.
export async function createFilingResolver(input: CreateFilingResolverInput): Promise<FilingResolver> {
  const folders: FolderInfo[] = await input.provider.listFolders();
  const namespace_root = findNamespaceRoot(folders, input.delimiter);
  const existing = new Set(folders.map((folder) => folder.path));
  const bound = new Map(input.bindings.map((binding) => [binding.logical_path, binding.folder]));

  // A binding matches a logical path EXACTLY. A sub-path does not inherit its parent's binding, on
  // purpose: `Finances` is bound to `INBOX.Finances - Ref` on felix@tellmann.co.za, and letting
  // `Finances/Tax` inherit it would have to invent `INBOX.Finances - Ref.Tax` from a name the operator
  // never wrote. Longest-prefix matching would also give every binding an unbounded, invisible blast
  // radius — re-parenting one path would silently move mail filed under all of its children. An unbound
  // sub-path renders and is created like any other, which is visible and correctable.
  return {
    resolve: async (logical_path: string): Promise<string> => {
      const binding = bound.get(logical_path);
      if (binding !== undefined) {
        // Not created and not checked for existence: a binding names a folder the operator says is
        // already there, and creating it would be this module inventing a folder from a name it was
        // handed. If it is missing, the move fails loudly against the real server, which is the correct
        // place for that to surface.
        return binding;
      }

      // `existing` is the whole memo, and one set is enough: it guards the only side effect here, while the
      // binding lookup and renderFolderPath are pure and cost nothing to repeat. So filing 400 messages
      // into one client folder issues one CREATE, and a second logical path that renders to the same
      // folder issues none.
      // Deliberately not concurrency-safe: two overlapping resolutions of the same new path can both pass
      // this check. Callers resolve sequentially, and createFolder treats an existing folder as success,
      // so the worst case is one wasted round trip rather than an error.
      const folder = renderFolderPath({ logical_path, delimiter: input.delimiter, namespace_root });
      if (!existing.has(folder)) {
        await input.provider.createFolder(folder);
        existing.add(folder);
      }
      return folder;
    },
  };
}
