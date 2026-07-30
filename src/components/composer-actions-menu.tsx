import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { AddIcon } from "./icons";

export interface ComposerActionsMenuProps {
  readonly disabled: boolean;
  readonly rollbackAvailable: boolean;
  readonly rollbackDisabled: boolean;
  readonly onOpenShaper: () => void;
  readonly onRollback: () => Promise<void>;
  readonly onOpenSafeMode: () => void;
}

const menuItems = (menu: HTMLDivElement) =>
  Array.from(
    menu.querySelectorAll<HTMLButtonElement>(
      '[role="menuitem"]:not(:disabled)',
    ),
  );

export function ComposerActionsMenu({
  disabled,
  rollbackAvailable,
  rollbackDisabled,
  onOpenShaper,
  onRollback,
  onOpenSafeMode,
}: ComposerActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) {
      return;
    }

    menuRef.current
      ?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')
      ?.focus();

    const dismissOutside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !rootRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    };

    const dismissFocusOutside = (event: FocusEvent) => {
      if (
        event.target instanceof Node &&
        !rootRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    };

    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("focusin", dismissFocusOutside);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("focusin", dismissFocusOutside);
    };
  }, [open]);

  useEffect(() => {
    if (disabled) {
      setOpen(false);
    }
  }, [disabled]);

  const dismissAndRestoreFocus = () => {
    setOpen(false);
    queueMicrotask(() => triggerRef.current?.focus());
  };

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      dismissAndRestoreFocus();
      return;
    }

    if (
      event.key !== "ArrowDown" &&
      event.key !== "ArrowUp" &&
      event.key !== "Home" &&
      event.key !== "End"
    ) {
      return;
    }

    const items = menuItems(event.currentTarget);
    if (items.length === 0) {
      return;
    }

    event.preventDefault();
    const activeElement = document.activeElement;
    const currentIndex =
      activeElement instanceof HTMLButtonElement
        ? items.indexOf(activeElement)
        : -1;
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : event.key === "ArrowDown"
            ? (currentIndex + 1 + items.length) % items.length
            : (currentIndex - 1 + items.length) % items.length;
    items[nextIndex]?.focus();
  };

  return (
    <div className="composer-menu" ref={rootRef}>
      <button
        aria-controls={open ? menuId : undefined}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Actions"
        className="composer-control composer-control--icon"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        ref={triggerRef}
        type="button"
      >
        <AddIcon />
      </button>

      {open && (
        <div
          aria-label="Flect actions"
          className="composer-popover composer-popover--actions"
          id={menuId}
          onKeyDown={handleMenuKeyDown}
          ref={menuRef}
          role="menu"
        >
          <button
            aria-label="Shape interface"
            className="composer-popover__item"
            onClick={() => {
              setOpen(false);
              onOpenShaper();
            }}
            role="menuitem"
            type="button"
          >
            <span>Shape interface</span>
            <small>Propose a validated revision</small>
          </button>
          <button
            aria-label="Roll back last change"
            className="composer-popover__item"
            disabled={!rollbackAvailable || rollbackDisabled}
            onClick={() => {
              setOpen(false);
              void onRollback();
            }}
            role="menuitem"
            type="button"
          >
            <span>Roll back last change</span>
            <small>
              {rollbackAvailable
                ? "Restore the previous interface"
                : "No previous revision"}
            </small>
          </button>
          <button
            aria-label="Open safe mode"
            className="composer-popover__item"
            onClick={() => {
              setOpen(false);
              onOpenSafeMode();
            }}
            role="menuitem"
            type="button"
          >
            <span>Open safe mode</span>
            <small>Bypass customized interface state</small>
          </button>
        </div>
      )}
    </div>
  );
}
