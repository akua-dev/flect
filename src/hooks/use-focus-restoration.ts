import { type RefObject, useEffect, useRef } from "react";

/**
 * Restores keyboard focus to a stable protected fallback when the focused
 * element inside the shell is removed from the DOM (canvas updates, list
 * rerenders) and focus would otherwise drop to `<body>`.
 *
 * The hook only remembers ephemeral interaction state (the last element that
 * held focus inside the shell) and never steals focus that legitimately moved
 * elsewhere: after a commit it restores only when that remembered element is
 * disconnected AND `document.activeElement` is `<body>`. While the user is
 * typing the active element is the input itself, and focus inside the capsule
 * iframe leaves the iframe element active, so both are left alone.
 */
export const useFocusRestoration = (
  shellRef: RefObject<HTMLElement | null>,
  restore: () => void,
) => {
  const lastFocusedRef = useRef<HTMLElement | undefined>(undefined);

  useEffect(() => {
    const remember = (event: FocusEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        shellRef.current?.contains(target) === true
      ) {
        lastFocusedRef.current = target;
      }
    };
    globalThis.document.addEventListener("focusin", remember);
    return () => globalThis.document.removeEventListener("focusin", remember);
  }, [shellRef]);

  // No dependency array: focus can be orphaned by any commit that replaces
  // canvas or rail content, so the check must run after every update.
  useEffect(() => {
    const previous = lastFocusedRef.current;
    if (
      previous !== undefined &&
      !previous.isConnected &&
      globalThis.document.activeElement === globalThis.document.body
    ) {
      lastFocusedRef.current = undefined;
      restore();
    }
  });
};
