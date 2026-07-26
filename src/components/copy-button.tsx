import { ClipboardDocumentCheckIcon, ClipboardDocumentIcon } from "@heroicons/react/24/solid";
import clsx from "clsx";
import { useCallback } from "react";
import { useToast } from "~/components/toast";

export const CopyButton = ({ content, className }: { className: string; content: string }) => {
  const { toasts, addToast } = useToast();

  const handleCopyCode = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      addToast({
        id: "copy-code",
        message: "Code Copied to Clipboard",
        timestamp: Date.now(),
      });
    } catch {
      addToast({
        id: "copy-code-failed",
        message: "Could not copy to clipboard",
        timestamp: Date.now(),
      });
    }
  }, [addToast, content]);

  return (
    <button className={clsx(className, "h-5 w-5 transition-colors")} onClick={() => handleCopyCode()} type="button">
      <span className="sr-only">Copy code</span>
      {toasts.some((notification) => notification.id === "copy-code") ? (
        <ClipboardDocumentCheckIcon className="h-5 w-5 text-sky-400" />
      ) : (
        <ClipboardDocumentIcon className="h-5 w-5" />
      )}
    </button>
  );
};
