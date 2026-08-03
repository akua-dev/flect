export type ShellMode = "run" | "edit" | "safe";
export type ConversationTarget = "use" | "shape";

export interface RoleSwitcherProps {
  readonly target: ConversationTarget;
  readonly disabled: boolean;
  readonly useDisabled: boolean;
  readonly onChange: (target: ConversationTarget) => void;
}

export function RoleSwitcher({
  target,
  disabled,
  useDisabled,
  onChange,
}: RoleSwitcherProps) {
  return (
    <fieldset className="role-switcher">
      <legend className="sr-only">Conversation target</legend>
      <button
        aria-label="Shape · Shaper"
        aria-pressed={target === "shape"}
        className="role-switcher__option"
        disabled={disabled}
        onClick={() => onChange("shape")}
        type="button"
      >
        <span className="role-switcher__mode">Shape</span>
        <span className="role-switcher__agent">Shaper</span>
      </button>
      <button
        aria-label="Use · App Agent"
        aria-pressed={target === "use"}
        className="role-switcher__option"
        disabled={disabled || useDisabled}
        onClick={() => onChange("use")}
        type="button"
      >
        <span className="role-switcher__mode">Use</span>
        <span className="role-switcher__agent">App Agent</span>
      </button>
    </fieldset>
  );
}
