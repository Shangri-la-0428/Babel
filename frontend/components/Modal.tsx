"use client";

import { useEffect, useCallback, useRef, useState, ReactNode } from "react";
import { useSpring } from "@/lib/spring";

interface ModalProps {
  children: ReactNode;
  onClose: () => void;
  ariaLabel: string;
  width?: string;
}

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export default function Modal({ children, onClose, ariaLabel, width = "max-w-lg" }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<Element | null>(null);
  const [closing, setClosing] = useState(false);
  const [entryGlow, setEntryGlow] = useState(true);

  // Spring physics — bouncy open, snappy close
  const springConfig = closing
    ? { tension: 300, friction: 28 }
    : { tension: 180, friction: 20 };
  const progress = useSpring(closing ? 0 : 1, springConfig, 0);

  // Spring-driven close detection (replaces setTimeout)
  useEffect(() => {
    if (closing && progress < 0.01) {
      onClose();
    }
  }, [closing, progress, onClose]);

  useEffect(() => {
    const t = setTimeout(() => setEntryGlow(false), 400);
    return () => clearTimeout(t);
  }, []);

  const startClose = useCallback(() => {
    if (closing) return;
    setClosing(true);
  }, [closing]);

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
      className="fixed inset-0 z-modal flex items-center justify-center bg-overlay"
      style={{ opacity: Math.min(progress * 1.5, 1) }}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      onClick={startClose}
    >
      <div
        ref={panelRef}
        className={`w-full ${width} max-w-[90vw] max-h-[85vh] bg-void border flex flex-col ${
          !closing && entryGlow
            ? "shadow-[0_0_12px_var(--color-primary-glow)] border-primary"
            : "shadow-none border-b-DEFAULT"
        } transition-[box-shadow,border-color] duration-300`}
        style={{
          transform: `translateY(${(1 - progress) * 16}px) scale(${0.97 + progress * 0.03})`,
          opacity: progress,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
