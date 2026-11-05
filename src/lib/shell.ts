/**
 * Shell context — app-level services handed down to pages without prop
 * drilling: navigation, the entry editor modal, and confirm dialogs.
 */
import { createContext, useContext } from "react";
import type { Entry, EntryKind, PageKey } from "@/types";

export interface ConfirmOpts {
  title: string;
  body: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
}

export type ModalRequest =
  | { mode: "create"; kind: EntryKind; presetDate?: string }
  | { mode: "edit"; entry: Entry };

export interface ShellApi {
  page: PageKey;
  navigate: (p: PageKey) => void;
  openCreate: (kind: EntryKind, presetDate?: string) => void;
  openEdit: (entry: Entry) => void;
  confirm: (opts: ConfirmOpts) => void;
}

export const ShellContext = createContext<ShellApi | null>(null);

export function useShell(): ShellApi {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShell must be used inside <ShellContext.Provider>");
  return ctx;
}
