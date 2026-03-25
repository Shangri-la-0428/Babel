"use client";

import { useEffect, useCallback, useRef, useState, ReactNode } from "react";

interface ModalProps {
  children: ReactNode;
  onClose: () => void;
  ariaLabel: string;
  width?: string;
}

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
const EXIT_MS = 150;

export default function Modal({ children, onClose, ariaLabel, width = "max-w-lg" }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<Element | null>(null);
  const [closing, setClosing] = useState(false);

  const startClose = useCallback(() => {
    if (closing) return;
    setClosing(true);
    setTimeout(onClose, EXIT_MS);
  }, [closing, onClose]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        startClose();
        return;
      }

      // Focus trap
      if (e.key === "Tab" && panelRef.current) {
        const focusable = panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE);
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    },
    [startClose]
  );

  useEffect(() => {
    // Save previously focused element to restore on close
    returnFocusRef.current = document.activeElement;

    // Lock background scroll
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    document.addEventListener("keydown", handleKeyDown);

    // Auto-focus first focusable element inside the modal
    const focusable = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
    if (focusable && focusable.length > 0) {
      focusable[0].focus();
    }

    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", handleKeyDown);
      // Restore focus
      if (returnFocusRef.current instanceof HTMLElement) {
        returnFocusRef.current.focus();
      }
    };
  }, [handleKeyDown]);

  return (
    <div
      className={`fixed inset-0 z-modal flex items-center justify-center bg-overlay ${
        closing
          ? "animate-[fade-out_150ms_ease_both]"
          : "animate-[fade-in_150ms_ease]"
      }`}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      onClick={startClose}
    >
      <div
        ref={panelRef}
        className={`w-full ${width} max-w-[90vw] max-h-[85vh] bg-void border border-b-DEFAULT flex flex-col ${
          closing
            ? "animate-[modal-exit_150ms_ease_both]"
            : "animate-[slide-up_150ms_ease]"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
