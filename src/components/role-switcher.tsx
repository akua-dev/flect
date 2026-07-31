export type ShellMode = "run" | "edit" | "safe";

export interface RoleSwitcherProps {
  readonly mode: Exclude<ShellMode, "safe">;
  readonly disabled: boolean;
  readonly onChange: (mode: Exclude<ShellMode, "safe">) => void;
}

export function RoleSwitcher({ mode, disabled, onChange }: RoleSwitcherProps) {
  return (
    <fieldset className="role-switcher">
      <legend className="sr-only">Agent role</legend>
      <button
        aria-label="Edit · Shaper"
        aria-pressed={mode === "edit"}
        className="role-switcher__option"
        disabled={disabled}
        onClick={() => onChange("edit")}
        type="button"
      >
        <span className="role-switcher__mode">Edit</span>
        <span className="role-switcher__agent">Shaper</span>
      </button>
      <button
        aria-label="Run · App Agent"
        aria-pressed={mode === "run"}
        className="role-switcher__option"
        disabled={disabled}
        onClick={() => onChange("run")}
        type="button"
      >
        <span className="role-switcher__mode">Run</span>
        <span className="role-switcher__agent">App Agent</span>
      </button>
    </fieldset>
  );
}
