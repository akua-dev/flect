import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import type { ModelSummary } from "../../shared/contracts";
import { ChevronIcon } from "./icons";

export interface ModelMenuProps {
  readonly models: ReadonlyArray<ModelSummary>;
  readonly selectedModel: ModelSummary | undefined;
  readonly disabled: boolean;
  readonly onSelect: (model: ModelSummary | undefined) => void;
}

const modelValue = (model: ModelSummary) => `${model.provider}:${model.id}`;

const modelItems = (menu: HTMLDivElement) =>
  Array.from(
    menu.querySelectorAll<HTMLButtonElement>(
      '[role="menuitemradio"]:not(:disabled)',
    ),
  );

export function ModelMenu({
  models,
  selectedModel,
  disabled,
  onSelect,
}: ModelMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const selectedValue =
    selectedModel === undefined ? "auto" : modelValue(selectedModel);
  const selectedLabel = selectedModel?.name ?? "Auto";

  useEffect(() => {
    if (!open) {
      return;
    }

    menuRef.current
      ?.querySelector<HTMLButtonElement>('[aria-checked="true"]')
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

  const closeAndFocusTrigger = () => {
    setOpen(false);
    queueMicrotask(() => triggerRef.current?.focus());
  };

  const select = (model: ModelSummary | undefined) => {
    closeAndFocusTrigger();
    onSelect(model);
  };

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeAndFocusTrigger();
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

    const items = modelItems(event.currentTarget);
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
    <div className="model-menu" ref={rootRef}>
      <button
        aria-controls={open ? menuId : undefined}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Model: ${
          selectedModel === undefined ? "Auto via Pi" : selectedLabel
        }`}
        className="composer-control model-menu__trigger"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        ref={triggerRef}
        type="button"
      >
        <span className="model-menu__selection">{selectedLabel}</span>
        <span className="model-menu__source">via Pi</span>
        <ChevronIcon className="model-menu__chevron" />
      </button>

      {open && (
        <div
          aria-label="Choose model"
          className="composer-popover composer-popover--models"
          id={menuId}
          onKeyDown={handleMenuKeyDown}
          ref={menuRef}
          role="menu"
        >
          <button
            aria-checked={selectedValue === "auto"}
            aria-label="Auto via Pi"
            className="composer-popover__item model-menu__option"
            onClick={() => select(undefined)}
            role="menuitemradio"
            type="button"
          >
            <span>
              <strong>Auto</strong>
              <small>Pi chooses an authenticated model</small>
            </span>
            <span aria-hidden="true" className="model-menu__check">
              {selectedValue === "auto" ? "✓" : ""}
            </span>
          </button>

          {models.map((model) => {
            const value = modelValue(model);
            return (
              <button
                aria-checked={selectedValue === value}
                aria-label={`${model.name} by ${model.provider}`}
                className="composer-popover__item model-menu__option"
                key={value}
                onClick={() => select(model)}
                role="menuitemradio"
                type="button"
              >
                <span>
                  <strong>{model.name}</strong>
                  <small>{model.provider}</small>
                </span>
                <span aria-hidden="true" className="model-menu__check">
                  {selectedValue === value ? "✓" : ""}
                </span>
              </button>
            );
          })}

          {models.length === 0 && (
            <p className="model-menu__empty">No authenticated Pi models</p>
          )}
        </div>
      )}
    </div>
  );
}
