import {
  type KeyboardEvent,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  AuthLoginEvent,
  AuthLoginReference,
  AuthLoginRequest,
  AuthSelectionReply,
  ModelSummary,
  ProviderAuthSummary,
  ReasoningLevel,
} from "../../shared/contracts";
import { ChevronIcon, SearchIcon, StarIcon } from "./icons";

const ProviderAuthPanel = lazy(() =>
  import("./provider-auth-panel").then((module) => ({
    default: module.ProviderAuthPanel,
  })),
);

export interface ModelMenuProps {
  readonly models: ReadonlyArray<ModelSummary>;
  readonly selectedModel: ModelSummary | undefined;
  readonly favoriteKeys: ReadonlyArray<string>;
  readonly disabled: boolean;
  readonly onSelect: (model: ModelSummary | undefined) => void;
  readonly onToggleFavorite: (modelKey: string) => Promise<void>;
  readonly reasoningLevel?: ReasoningLevel;
  readonly providers?: ReadonlyArray<ProviderAuthSummary>;
  readonly authEvent?: AuthLoginEvent;
  readonly providerAuthVisible?: boolean;
  readonly onSelectReasoning?: (
    reasoningLevel: ReasoningLevel | undefined,
  ) => void;
  readonly onLoginProvider?: (request: AuthLoginRequest) => void;
  readonly onReplyProviderAuth?: (reply: AuthSelectionReply) => Promise<void>;
  readonly onCancelProviderAuth?: (
    reference: AuthLoginReference,
  ) => Promise<void>;
  readonly onRefreshProviderAuth?: () => Promise<void>;
  readonly onLogoutProvider?: (providerId: string) => Promise<void>;
}

export const modelValue = (model: ModelSummary) =>
  `${model.provider}:${model.id}`;

const FAVORITES_FILTER = "favorites";

const selectableItems = (menu: HTMLDivElement) =>
  Array.from(
    menu.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)'),
  );

const providerMark = (provider: string) =>
  provider
    .split(/[\s_-]+/u)
    .filter(Boolean)
    .map((part) => part[0]?.toLocaleUpperCase())
    .join("")
    .slice(0, 2) || "P";

export function ModelMenu({
  models,
  selectedModel,
  favoriteKeys,
  disabled,
  onSelect,
  onToggleFavorite,
  reasoningLevel,
  providers: authProviders = [],
  authEvent,
  providerAuthVisible = true,
  onSelectReasoning = () => undefined,
  onLoginProvider = () => undefined,
  onReplyProviderAuth = async () => undefined,
  onCancelProviderAuth = async () => undefined,
  onRefreshProviderAuth = async () => undefined,
  onLogoutProvider = async () => undefined,
}: ModelMenuProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const searchId = useId();
  const selectedValue =
    selectedModel === undefined ? "auto" : modelValue(selectedModel);
  const selectedLabel = selectedModel?.name ?? "Auto";
  const reasoningModel = selectedModel ?? models[0];
  const favorites = useMemo(() => new Set(favoriteKeys), [favoriteKeys]);
  const providers = useMemo(
    () => Array.from(new Set(models.map((model) => model.provider))),
    [models],
  );
  const initialProviderFilter =
    favorites.size > 0
      ? FAVORITES_FILTER
      : (selectedModel?.provider ?? providers[0] ?? FAVORITES_FILTER);
  const [providerFilter, setProviderFilter] = useState(initialProviderFilter);
  const [showTopScrollFade, setShowTopScrollFade] = useState(false);
  const [showBottomScrollFade, setShowBottomScrollFade] = useState(false);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const searchedModels = useMemo(
    () =>
      models.filter((model) =>
        `${model.name} ${model.id} ${model.provider}`
          .toLocaleLowerCase()
          .includes(normalizedQuery),
      ),
    [models, normalizedQuery],
  );
  const filtered = useMemo(() => {
    const visible =
      normalizedQuery.length > 0
        ? searchedModels
        : providerFilter === FAVORITES_FILTER
          ? searchedModels.filter((model) => favorites.has(modelValue(model)))
          : searchedModels.filter((model) => model.provider === providerFilter);
    return visible.toSorted((left, right) => {
      const favoriteDelta =
        Number(favorites.has(modelValue(right))) -
        Number(favorites.has(modelValue(left)));
      return (
        favoriteDelta ||
        left.name.localeCompare(right.name) ||
        left.id.localeCompare(right.id)
      );
    });
  }, [favorites, normalizedQuery.length, providerFilter, searchedModels]);
  const providerGroups = useMemo(
    () =>
      Array.from(new Set(filtered.map((model) => model.provider))).map(
        (provider) => ({
          provider,
          models: filtered.filter((model) => model.provider === provider),
        }),
      ),
    [filtered],
  );

  const updateScrollFades = useCallback(() => {
    const list = listRef.current;
    if (list === null) {
      return;
    }
    const remaining = list.scrollHeight - list.clientHeight - list.scrollTop;
    setShowTopScrollFade(list.scrollTop > 1);
    setShowBottomScrollFade(remaining > 1);
  }, []);

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

  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    if (filtered.length === 0) {
      setShowTopScrollFade(false);
      setShowBottomScrollFade(false);
      return;
    }
    updateScrollFades();
  }, [filtered.length, open, updateScrollFades]);

  const closeAndFocusTrigger = () => {
    setOpen(false);
    queueMicrotask(() => triggerRef.current?.focus());
  };

  const select = (model: ModelSummary | undefined) => {
    closeAndFocusTrigger();
    onSelect(model);
  };

  const selectProvider = (provider: string) => {
    setProviderFilter(provider);
    queueMicrotask(() => searchRef.current?.focus());
  };

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    setProviderFilter(initialProviderFilter);
    setOpen(true);
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

  const emptyMessage =
    models.length === 0
      ? "No authenticated Pi models"
      : normalizedQuery.length > 0
        ? `No models match “${query.trim()}”`
        : providerFilter === FAVORITES_FILTER
          ? "No favorite models yet"
          : `No models available from ${providerFilter}`;

  return (
    <div className="model-menu" ref={rootRef}>
      <button
        aria-controls={open ? menuId : undefined}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Model: ${
          selectedModel === undefined ? "Auto via Pi" : selectedLabel
        }`}
        className="composer-control model-menu__trigger"
        disabled={disabled}
        onClick={toggle}
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
          role="dialog"
        >
          {!normalizedQuery && (
            <nav
              aria-label="Model providers"
              className="model-menu__provider-rail"
            >
              <button
                aria-label="Favorites"
                aria-pressed={providerFilter === FAVORITES_FILTER}
                className="model-menu__provider"
                onClick={() => selectProvider(FAVORITES_FILTER)}
                title="Favorites"
                type="button"
              >
                <StarIcon filled={providerFilter === FAVORITES_FILTER} />
              </button>
              <span
                aria-hidden="true"
                className="model-menu__provider-separator"
              />
              {providers.map((provider) => (
                <button
                  aria-label={provider}
                  aria-pressed={providerFilter === provider}
                  className="model-menu__provider"
                  key={provider}
                  onClick={() => selectProvider(provider)}
                  title={provider}
                  type="button"
                >
                  <span aria-hidden="true">{providerMark(provider)}</span>
                </button>
              ))}
            </nav>
          )}

          <div className="model-menu__content">
            <label className="model-menu__search" htmlFor={searchId}>
              <SearchIcon />
              <span className="sr-only">Search models</span>
              <input
                aria-label="Search models"
                id={searchId}
                name="model-search"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search models"
                ref={searchRef}
                type="search"
                value={query}
              />
            </label>
            <div
              aria-label="Model choices"
              className={`model-menu__list${showTopScrollFade ? " model-menu__list--fade-top" : ""}${showBottomScrollFade ? " model-menu__list--fade-bottom" : ""}`}
              onScroll={updateScrollFades}
              ref={listRef}
              role="radiogroup"
            >
              {!normalizedQuery && (
                // biome-ignore lint/a11y/useSemanticElements: the styled radio is an action row with focus restoration, not a standalone form field
                <button
                  aria-checked={selectedValue === "auto"}
                  aria-label="Auto via Pi"
                  className="composer-popover__item model-menu__option"
                  onClick={() => select(undefined)}
                  role="radio"
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

              {providerGroups.map((group) => (
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
                        {/* biome-ignore lint/a11y/useSemanticElements: the styled radio is an action row with a sibling favorite control */}
                        <button
                          aria-checked={selectedValue === value}
                          aria-label={`${model.name} by ${model.provider}`}
                          className="composer-popover__item model-menu__option"
                          onClick={() => select(model)}
                          role="radio"
                          type="button"
                        >
                          <span>
                            <strong>{model.name}</strong>
                            <small>{model.id}</small>
                          </span>
                          <span
                            aria-hidden="true"
                            className="model-menu__check"
                          >
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
                <p className="model-menu__empty">{emptyMessage}</p>
              )}
            </div>
            {reasoningModel !== undefined && (
              <section
                aria-label="Reasoning effort"
                className="model-menu__reasoning"
              >
                <div>
                  <strong>Reasoning</strong>
                  <small>{reasoningModel.name}</small>
                </div>
                <div role="radiogroup" aria-label="Reasoning effort">
                  {/* biome-ignore lint/a11y/useSemanticElements: compact popover actions preserve focus and announce checked state */}
                  <button
                    aria-checked={reasoningLevel === undefined}
                    onClick={() => onSelectReasoning(undefined)}
                    role="radio"
                    type="button"
                  >
                    Auto
                  </button>
                  {reasoningModel.reasoningLevels.map((level) => (
                    // biome-ignore lint/a11y/useSemanticElements: compact popover actions preserve focus and announce checked state
                    <button
                      aria-checked={reasoningLevel === level}
                      key={level}
                      onClick={() => onSelectReasoning(level)}
                      role="radio"
                      type="button"
                    >
                      {level === "xhigh"
                        ? "Extra high"
                        : level[0]?.toUpperCase() + level.slice(1)}
                    </button>
                  ))}
                </div>
              </section>
            )}
            {providerAuthVisible &&
              (authProviders.length > 0 ||
                models.length === 0 ||
                authEvent) && (
                <Suspense
                  fallback={
                    <span className="sr-only" role="status">
                      Opening provider controls
                    </span>
                  }
                >
                  <ProviderAuthPanel
                    authEvent={authEvent}
                    disabled={disabled}
                    onCancel={onCancelProviderAuth}
                    onLogin={onLoginProvider}
                    onLogout={onLogoutProvider}
                    onRefresh={onRefreshProviderAuth}
                    onReply={onReplyProviderAuth}
                    providers={authProviders}
                  />
                </Suspense>
              )}
          </div>
        </div>
      )}
    </div>
  );
}
