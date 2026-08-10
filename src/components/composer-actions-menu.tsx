import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type { GitRepositoryStatus } from "../../shared/git-workspace";
import { AddIcon } from "./icons";

export interface ComposerActionsMenuProps {
  readonly disabled: boolean;
  readonly rollbackAvailable: boolean;
  readonly rollbackDisabled: boolean;
  readonly onRollback: () => Promise<void>;
  readonly onExportRepository: () => Promise<void>;
  readonly onExportCapsule?: () => Promise<void>;
  readonly onImportCapsule?: () => void;
  readonly onInstallCapsule?: () => void;
  readonly onImportWebProject?: () => void;
  readonly onImportWebProjectArchive?: () => void;
  readonly onImportWebProjectGit?: () => void;
  readonly onOpenShareSource?: () => void;
  readonly onOpenShareFile?: () => void;
  readonly onManageSharedSources?: () => void;
  readonly repository?: GitRepositoryStatus;
  readonly onOpenSafeMode: () => void;
  readonly externalExtensionsEnabled: boolean;
  readonly onToggleExternalExtensions: () => Promise<void>;
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
  onRollback,
  onExportRepository,
  onExportCapsule,
  onImportCapsule,
  onInstallCapsule,
  onImportWebProject,
  onImportWebProjectArchive,
  onImportWebProjectGit,
  onOpenShareSource,
  onOpenShareFile,
  onManageSharedSources,
  repository,
  onOpenSafeMode,
  externalExtensionsEnabled,
  onToggleExternalExtensions,
}: ComposerActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties>();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) {
      return;
    }

    const dialog = dialogRef.current;
    if (dialog !== null && !dialog.open) {
      if (typeof dialog.showModal === "function") {
        dialog.showModal();
      } else {
        dialog.setAttribute("open", "");
      }
    }

    menuRef.current
      ?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')
      ?.focus();

    return () => {
      if (dialog?.open) {
        if (typeof dialog.close === "function") {
          dialog.close();
        } else {
          dialog.removeAttribute("open");
        }
      }
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

  const dismissFromBackdrop = (event: PointerEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) {
      dismissAndRestoreFocus();
    }
  };

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
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
    <div className="composer-menu">
      <button
        aria-controls={open ? menuId : undefined}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Actions"
        className="composer-control composer-control--icon"
        disabled={disabled}
        onClick={(event) => {
          if (open) {
            dismissAndRestoreFocus();
            return;
          }
          const rect = event.currentTarget.getBoundingClientRect();
          setPosition({
            bottom: `${globalThis.innerHeight - rect.top + 10}px`,
            left: `${Math.max(12, Math.min(rect.left, globalThis.innerWidth - 372))}px`,
            maxHeight: `${Math.max(240, rect.top - 22)}px`,
          });
          setOpen(true);
        }}
        ref={triggerRef}
        type="button"
      >
        <AddIcon />
      </button>

      {open && (
        <dialog
          aria-label="Flect actions"
          className="composer-popover composer-popover--actions"
          onCancel={(event) => {
            event.preventDefault();
            dismissAndRestoreFocus();
          }}
          onPointerDown={dismissFromBackdrop}
          ref={dialogRef}
          style={position}
        >
          <div className="composer-popover__context" role="status">
            <span>History</span>
            <small>
              {repository?.acceptedCommit === undefined
                ? "Preparing version history"
                : repository.conflictPaths.length > 0
                  ? `${repository.conflictPaths.length} conflict${repository.conflictPaths.length === 1 ? "" : "s"} need recovery`
                  : repository.proposalCommit === undefined
                    ? "Current version saved"
                    : "External change waiting for activation"}
            </small>
          </div>
          <div
            aria-label="Flect actions"
            id={menuId}
            onKeyDown={handleMenuKeyDown}
            ref={menuRef}
            role="menu"
          >
            <button
              aria-label="Undo last change"
              className="composer-popover__item"
              disabled={!rollbackAvailable || rollbackDisabled}
              onClick={() => {
                setOpen(false);
                void onRollback();
              }}
              role="menuitem"
              type="button"
            >
              <span>Undo last change</span>
              <small>
                {rollbackAvailable
                  ? "Restore the previous interface"
                  : "No previous revision"}
              </small>
            </button>
            {onExportCapsule !== undefined && (
              <button
                aria-label="Export Flect app"
                className="composer-popover__item"
                onClick={() => {
                  setOpen(false);
                  void onExportCapsule();
                }}
                role="menuitem"
                type="button"
              >
                <span>Export Flect app</span>
                <small>Share an offline .flect capsule</small>
              </button>
            )}
            {onImportCapsule !== undefined && (
              <button
                aria-label="Import Flect app"
                className="composer-popover__item"
                onClick={() => {
                  setOpen(false);
                  onImportCapsule();
                }}
                role="menuitem"
                type="button"
              >
                <span>Import Flect app</span>
                <small>Preview a verified .flect capsule</small>
              </button>
            )}
            {onInstallCapsule !== undefined && (
              <button
                aria-label="Install Flect app from URL"
                className="composer-popover__item"
                onClick={() => {
                  setOpen(false);
                  onInstallCapsule();
                }}
                role="menuitem"
                type="button"
              >
                <span>Install from URL</span>
                <small>Download, verify, and review a .flect app</small>
              </button>
            )}
            {onImportWebProject !== undefined && (
              <button
                aria-label="Import app project"
                className="composer-popover__item"
                onClick={() => {
                  setOpen(false);
                  onImportWebProject();
                }}
                role="menuitem"
                type="button"
              >
                <span>Import app project</span>
                <small>Choose a static HTML or standard Vite folder</small>
              </button>
            )}
            {onImportWebProjectArchive !== undefined && (
              <button
                aria-label="Import project archive"
                className="composer-popover__item"
                onClick={() => {
                  setOpen(false);
                  onImportWebProjectArchive();
                }}
                role="menuitem"
                type="button"
              >
                <span>Import project archive</span>
                <small>Choose a bounded ZIP or POSIX TAR source</small>
              </button>
            )}
            {onImportWebProjectGit !== undefined && (
              <button
                aria-label="Import project from Git"
                className="composer-popover__item"
                onClick={() => {
                  setOpen(false);
                  onImportWebProjectGit();
                }}
                role="menuitem"
                type="button"
              >
                <span>Import from Git</span>
                <small>Bind public HTTPS source to an exact commit</small>
              </button>
            )}
            {(onOpenShareSource !== undefined ||
              onOpenShareFile !== undefined ||
              onManageSharedSources !== undefined) && (
              <fieldset className="composer-popover__group">
                <legend className="composer-popover__section">
                  Share and review
                </legend>
                {onOpenShareSource !== undefined && (
                  <button
                    aria-label="Review shared source"
                    className="composer-popover__item"
                    onClick={() => {
                      setOpen(false);
                      onOpenShareSource();
                    }}
                    role="menuitem"
                    type="button"
                  >
                    <span>Review shared source</span>
                    <small>
                      Open a shared file URL or exact public Git revision
                    </small>
                  </button>
                )}
                {onOpenShareFile !== undefined && (
                  <button
                    aria-label="Open shared file"
                    className="composer-popover__item"
                    onClick={() => {
                      setOpen(false);
                      onOpenShareFile();
                    }}
                    role="menuitem"
                    type="button"
                  >
                    <span>Open shared file</span>
                    <small>Inspect a local .flect-share archive</small>
                  </button>
                )}
                {onManageSharedSources !== undefined && (
                  <button
                    aria-label="Manage shared sources"
                    className="composer-popover__item"
                    onClick={() => {
                      setOpen(false);
                      onManageSharedSources();
                    }}
                    role="menuitem"
                    type="button"
                  >
                    <span>Manage shared sources</span>
                    <small>Export, remove, or delete retained forks</small>
                  </button>
                )}
              </fieldset>
            )}
            <button
              aria-label="Export source and history"
              className="composer-popover__item"
              onClick={() => {
                setOpen(false);
                void onExportRepository();
              }}
              role="menuitem"
              type="button"
            >
              <span>Export source and history</span>
              <small>Download a portable Git repository</small>
            </button>
            <button
              aria-label={
                externalExtensionsEnabled
                  ? "Disable trusted Pi extensions"
                  : "Enable trusted Pi extensions"
              }
              className="composer-popover__item"
              onClick={() => {
                setOpen(false);
                void onToggleExternalExtensions();
              }}
              role="menuitem"
              type="button"
            >
              <span>
                {externalExtensionsEnabled
                  ? "Disable trusted Pi extensions"
                  : "Enable trusted Pi extensions"}
              </span>
              <small>
                {externalExtensionsEnabled
                  ? "Keep configured external code out of this role"
                  : "Allow Pi's configured external code in this role"}
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
        </dialog>
      )}
    </div>
  );
}
