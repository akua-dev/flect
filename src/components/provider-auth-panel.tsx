import { Effect } from "effect";
import { useState } from "react";
import {
  type AuthLoginEvent,
  AuthLoginReference,
  AuthLoginRequest,
  AuthSelectionReply,
  type ProviderAuthSummary,
} from "../../shared/contracts";
import { Button, LinkButton } from "./ui/button";

export interface ProviderAuthPanelProps {
  readonly providers: ReadonlyArray<ProviderAuthSummary>;
  readonly authEvent: AuthLoginEvent | undefined;
  readonly disabled: boolean;
  readonly onLogin: (request: AuthLoginRequest) => void;
  readonly onReply: (reply: AuthSelectionReply) => Promise<void>;
  readonly onCancel: (reference: AuthLoginReference) => Promise<void>;
  readonly onRefresh: () => Promise<void>;
  readonly onLogout: (providerId: string) => Promise<void>;
  readonly compact?: boolean;
}

const isActive = (event: AuthLoginEvent | undefined) =>
  event !== undefined &&
  event.type !== "auth_connected" &&
  event.type !== "auth_cancelled" &&
  event.type !== "auth_failed";

const failureMessage = (
  event: Extract<AuthLoginEvent, { type: "auth_failed" }>,
) =>
  event.code === "expired"
    ? "This login expired. Start it again when you’re ready."
    : event.code === "denied"
      ? "The provider declined this login. You can try again or choose another method."
      : event.code === "unsupported"
        ? "This login method is not supported here. Choose another method."
        : event.code === "entry-unavailable"
          ? "Secure entry is unavailable. Return to Flect and try again."
          : event.code === "malformed"
            ? "The provider returned an unsafe or invalid response. Try another method."
            : "Provider login could not be completed. Try again.";

function AuthStep({
  event,
  disabled,
  onCopy,
  onReply,
}: Pick<ProviderAuthPanelProps, "disabled" | "onReply"> & {
  readonly event: AuthLoginEvent;
  readonly onCopy: (value: string, label: string) => void;
}) {
  switch (event.type) {
    case "auth_url":
      return (
        <div className="provider-auth__step">
          <LinkButton
            href={event.url}
            rel="noreferrer noopener"
            target="_blank"
            variant="primary"
          >
            Open provider sign-in
          </LinkButton>
          <Button
            isDisabled={disabled}
            onPress={() => onCopy(event.url, "Sign-in link")}
          >
            Copy link
          </Button>
        </div>
      );
    case "auth_device_code":
      return (
        <div className="provider-auth__step">
          <code>{event.userCode}</code>
          <Button
            isDisabled={disabled}
            onPress={() => onCopy(event.userCode, "Device code")}
          >
            Copy code
          </Button>
          <LinkButton
            href={event.verificationUrl}
            rel="noreferrer noopener"
            target="_blank"
            variant="primary"
          >
            Open verification page
          </LinkButton>
        </div>
      );
    case "auth_selection_required":
      return (
        <div className="provider-auth__step">
          <p>{event.message}</p>
          {event.options.map((option) => (
            <Button
              isDisabled={disabled}
              key={option.id}
              onPress={() =>
                void onReply(
                  AuthSelectionReply.make({
                    loginId: event.loginId,
                    promptId: event.promptId,
                    optionId: option.id,
                  }),
                )
              }
            >
              {option.label}
            </Button>
          ))}
        </div>
      );
    case "auth_protected_entry":
      return (
        <div className="provider-auth__step">
          <p>{event.label}</p>
          <LinkButton
            href={event.url}
            rel="noreferrer noopener"
            target="_blank"
            variant="primary"
          >
            Continue securely
          </LinkButton>
          <Button
            isDisabled={disabled}
            onPress={() => onCopy(event.url, "Secure-entry link")}
          >
            Copy secure link
          </Button>
        </div>
      );
    case "auth_connected":
      return <p>Provider connected. Models are refreshing.</p>;
    case "auth_cancelled":
      return <p>Provider login cancelled.</p>;
    case "auth_failed":
      return <p>{failureMessage(event)}</p>;
    case "auth_started":
      return <p>Starting provider login…</p>;
    case "auth_info":
      return (
        <div className="provider-auth__step">
          <p>{event.message}</p>
          {event.links?.map((link) => (
            <LinkButton
              href={link.url}
              key={link.url}
              rel="noreferrer noopener"
              target="_blank"
              variant="ghost"
            >
              {link.label ?? "Open provider information"}
            </LinkButton>
          ))}
        </div>
      );
    case "auth_progress":
      return <p>{event.message}</p>;
  }
}

export function ProviderAuthPanel({
  providers,
  authEvent,
  disabled,
  onLogin,
  onReply,
  onCancel,
  onRefresh,
  onLogout,
  compact = false,
}: ProviderAuthPanelProps) {
  const [copyNotice, setCopyNotice] = useState<string>();
  const [logoutConfirmation, setLogoutConfirmation] = useState<string>();
  const [showAllProviders, setShowAllProviders] = useState(false);
  const recommendedProvider =
    providers.find(
      (provider) =>
        provider.id === "openai-codex" &&
        provider.status !== "connected" &&
        provider.methods.length > 0,
    ) ??
    providers.find(
      (provider) =>
        provider.status !== "connected" &&
        provider.methods.some((method) => method.type === "oauth"),
    ) ??
    providers.find(
      (provider) =>
        provider.status !== "connected" && provider.methods.length > 0,
    ) ??
    providers[0];
  const visibleProviders =
    compact && !showAllProviders && recommendedProvider !== undefined
      ? [recommendedProvider]
      : providers;
  const hiddenProviderCount = Math.max(
    0,
    providers.length - visibleProviders.length,
  );
  const copyPublicValue = (value: string, label: string) => {
    void Effect.runPromise(
      Effect.tryPromise({
        try: () => {
          if (globalThis.navigator?.clipboard?.writeText === undefined) {
            return Promise.reject(new Error("Clipboard API unavailable"));
          }
          return globalThis.navigator.clipboard.writeText(value);
        },
        catch: () => undefined,
      }).pipe(
        Effect.match({
          onFailure: () => setCopyNotice("Copy unavailable."),
          onSuccess: () => setCopyNotice(`${label} copied.`),
        }),
      ),
    );
  };

  return (
    <section aria-label="Pi providers" className="provider-auth">
      <header>
        <div>
          <strong>Pi providers</strong>
          <small>Credentials stay in Pi’s local runtime.</small>
        </div>
        <Button
          aria-label="Refresh providers"
          isDisabled={disabled}
          onPress={() => void onRefresh()}
          variant="ghost"
        >
          Refresh
        </Button>
      </header>

      <div className="provider-auth__providers">
        {visibleProviders.map((provider) => (
          <div className="provider-auth__provider" key={provider.id}>
            <span>
              <strong>{provider.name}</strong>
              <small>
                {provider.status === "connected"
                  ? (provider.sourceLabel ?? "Connected through Pi")
                  : provider.status === "needs-attention"
                    ? "Needs attention"
                    : "Not connected"}
              </small>
            </span>
            <div className="provider-auth__actions">
              {provider.status === "connected" ? (
                <Button
                  isDisabled={disabled || isActive(authEvent)}
                  onPress={() => setLogoutConfirmation(provider.id)}
                  variant="ghost"
                >
                  Disconnect
                </Button>
              ) : (
                provider.methods.map((method) => (
                  <Button
                    aria-label={method.label}
                    isDisabled={disabled || isActive(authEvent)}
                    key={method.type}
                    onPress={() =>
                      onLogin(
                        AuthLoginRequest.make({
                          providerId: provider.id,
                          method: method.type,
                        }),
                      )
                    }
                    variant={
                      provider === recommendedProvider ? "primary" : "secondary"
                    }
                  >
                    {method.label}
                  </Button>
                ))
              )}
              {logoutConfirmation === provider.id && (
                <div className="provider-auth__confirmation">
                  <small>Active private sessions will restart.</small>
                  <Button
                    onPress={() => setLogoutConfirmation(undefined)}
                    variant="ghost"
                  >
                    Cancel
                  </Button>
                  <Button
                    onPress={() => {
                      setLogoutConfirmation(undefined);
                      void onLogout(provider.id);
                    }}
                    variant="destructive"
                  >
                    Confirm disconnect
                  </Button>
                </div>
              )}
            </div>
          </div>
        ))}
        {providers.length === 0 && <p>No Pi providers are available.</p>}
        {compact && providers.length > 1 && (
          <Button
            aria-expanded={showAllProviders}
            className="provider-auth__more"
            isDisabled={disabled || isActive(authEvent)}
            onPress={() => setShowAllProviders((current) => !current)}
            variant="ghost"
          >
            {showAllProviders
              ? "Show recommended provider"
              : `Other providers (${hiddenProviderCount})`}
          </Button>
        )}
      </div>

      {authEvent !== undefined && (
        <div aria-live="polite" className="provider-auth__flow" role="status">
          <AuthStep
            disabled={disabled}
            event={authEvent}
            onCopy={copyPublicValue}
            onReply={onReply}
          />
          {isActive(authEvent) && (
            <Button
              isDisabled={disabled}
              onPress={() =>
                void onCancel(
                  AuthLoginReference.make({ loginId: authEvent.loginId }),
                )
              }
              variant="ghost"
            >
              Cancel login
            </Button>
          )}
        </div>
      )}
      {copyNotice !== undefined && (
        <p aria-live="polite" className="provider-auth__copy-notice">
          {copyNotice}
        </p>
      )}
    </section>
  );
}
