import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import "./Modal.css";

// The one modal shell.
//
// Seven dialogs used to each carry their own backdrop, Escape listener,
// and click-outside handling, and none of them managed focus: Tab
// walked the app behind the dialog, and closing left focus wherever it
// had been. A native <dialog> opened with showModal() gives the focus
// trap, the inert background, Escape, and the backdrop for free; this
// adds the two things it doesn't — initial focus on the first control,
// and focus back on whatever opened the dialog when it closes.
//
// In jsdom, which has no showModal, the dialog is opened with the `open`
// attribute so tests still see it; the focus handling here runs in both.

type Props = {
  // id of the heading that names the dialog.
  labelledBy: string;
  testId?: string;
  onClose: () => void;
  // Content width in px; the content box is otherwise 540px.
  width?: number;
  // Class for the content box; the modal shell class by default.
  contentClassName?: string;
  // Keys the dialog's content handles beyond Escape, e.g. Enter to
  // confirm, arrows to move a selection. Scoped to the dialog, not the
  // window: a keystroke elsewhere is not an answer to the dialog.
  onKeyDown?: (e: KeyboardEvent<HTMLDialogElement>) => void;
  children: ReactNode;
};

const FOCUSABLE =
  '[autofocus], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({
  labelledBy,
  testId,
  onClose,
  width,
  contentClassName,
  onKeyDown,
  children,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (typeof el.showModal === "function") {
      if (!el.open) el.showModal();
    } else {
      el.setAttribute("open", "");
    }
    const first = el.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? el).focus();
    return () => {
      if (opener && document.contains(opener)) opener.focus();
    };
  }, []);

  // Escape: the native `cancel` event where the browser sends one, and
  // a window listener for where it doesn't (jsdom) or when focus has
  // somehow left the dialog.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <dialog
      ref={ref}
      className="fm-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      data-testid={testId}
      tabIndex={-1}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        // A click on the dialog element itself is a click on the
        // backdrop; the content box stops its own clicks below.
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") return; // the window listener has it
        onKeyDown?.(e);
      }}
    >
      <div
        className={contentClassName ?? "fm-modal"}
        role="document"
        style={width ? { width } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </dialog>
  );
}
