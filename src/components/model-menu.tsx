import {
  type KeyboardEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ModelSummary } from "../../shared/contracts";
import { ChevronIcon, SearchIcon, StarIcon } from "./icons";

export interface ModelMenuProps {
  readonly models: ReadonlyArray<ModelSummary>;
  readonly selectedModel: ModelSummary | undefined;
  readonly favoriteKeys: ReadonlyArray<string>;
  readonly disabled: boolean;
  readonly onSelect: (model: ModelSummary | undefined) => void;
  readonly onToggleFavorite: (modelKey: string) => Promise<void>;
}

export const modelValue = (model: ModelSummary) =>
  `${model.provider}:${model.id}`;

const selectableItems = (menu: HTMLDivElement) =>
  Array.from(
    menu.querySelectorAll<HTMLButtonElement>(
      '[role="menuitemradio"]:not(:disabled)',
    ),
  );

export function ModelMenu({
  models,
  selectedModel,
  favoriteKeys,
  disabled,
  onSelect,
  onToggleFavorite,
}: ModelMenuProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const menuId = useId();
  const selectedValue =
    selectedModel === undefined ? "auto" : modelValue(selectedModel);
  const selectedLabel = selectedModel?.name ?? "Auto";
  const favorites = useMemo(() => new Set(favoriteKeys), [favoriteKeys]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filtered = useMemo(
    () =>
      models.filter((model) =>
        `${model.name} ${model.id} ${model.provider}`
          .toLocaleLowerCase()
          .includes(normalizedQuery),
      ),
    [models, normalizedQuery],
  );
  const providers = useMemo(
    () =>
      Array.from(new Set(filtered.map((model) => model.provider))).map(
        (provider) => ({
          provider,
          models: filtered.filter((model) => model.provider === provider),
        }),
      ),
    [filtered],
  );

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }

    queueMicrotask(() => searchRef.current?.focus());
    const dismissOutside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !rootRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", dismissOutside);
    return () => document.removeEventListener("pointerdown", dismissOutside);
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

    const items = selectableItems(event.currentTarget);
    if (items.length === 0) {
      return;
    }
    event.preventDefault();
    const currentIndex =
      document.activeElement instanceof HTMLButtonElement
        ? items.indexOf(document.activeElement)
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
          <label className="model-menu__search">
            <SearchIcon />
            <span className="sr-only">Search models</span>
            <input
              aria-label="Search models"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search models"
              ref={searchRef}
              type="search"
              value={query}
            />
          </label>
          <div className="model-menu__list">
            {!normalizedQuery && (
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
            )}

            {providers.map((group) => (
              <section
                aria-label={group.provider}
                className="model-menu__group"
                key={group.provider}
              >
                <h3>{group.provider}</h3>
                {group.models.map((model) => {
                  const value = modelValue(model);
                  const favorite = favorites.has(value);
                  return (
                    <div className="model-menu__row" key={value}>
                      <button
                        aria-checked={selectedValue === value}
                        aria-label={`${model.name} by ${model.provider}`}
                        className="composer-popover__item model-menu__option"
                        onClick={() => select(model)}
                        role="menuitemradio"
                        type="button"
                      >
                        <span>
                          <strong>{model.name}</strong>
                          <small>{model.id}</small>
                        </span>
                        <span aria-hidden="true" className="model-menu__check">
                          {selectedValue === value ? "✓" : ""}
                        </span>
                      </button>
                      <button
                        aria-label={`${favorite ? "Remove" : "Add"} ${model.name} ${favorite ? "from" : "to"} favorites`}
                        aria-pressed={favorite}
                        className="model-menu__favorite"
                        onClick={() => void onToggleFavorite(value)}
                        type="button"
                      >
                        <StarIcon filled={favorite} />
                      </button>
                    </div>
                  );
                })}
              </section>
            ))}

            {filtered.length === 0 && (
              <p className="model-menu__empty">
                {models.length === 0
                  ? "No authenticated Pi models"
                  : `No models match “${query.trim()}”`}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
