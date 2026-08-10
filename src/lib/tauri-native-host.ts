import { Context, type Effect } from "effect";
import type { FlectUnavailableError } from "./api";

export interface TauriNativeHostShape {
  readonly invoke: (
    command:
      | "shell_link_status"
      | "shell_link_install"
      | "shell_link_remove"
      | "native_application_path"
      | "native_system_accent_color"
      | "native_update_status"
      | "native_update_check"
      | "native_update_install"
      | "native_update_relaunch",
    args?: Readonly<Record<string, unknown>>,
  ) => Effect.Effect<unknown, FlectUnavailableError>;
}

export class TauriNativeHost extends Context.Service<
  TauriNativeHost,
  TauriNativeHostShape
>()("flect/TauriNativeHost") {}
