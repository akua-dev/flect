import { useEffect, useState } from "react";
import {
  defaultInterfaceDocument,
  type InterfaceDocument,
} from "../shared/interface-document";
import { Launcher } from "./components/launcher";
import { useAgentSession } from "./hooks/use-agent-session";
import { loadInterfaceDocument } from "./lib/interface-store";
import { browserRuntime } from "./lib/runtime";

const safeMode =
  new URLSearchParams(globalThis.location.search).get("safe") === "1";

export function App() {
  const [document, setDocument] = useState<InterfaceDocument>(
    defaultInterfaceDocument,
  );
  const session = useAgentSession();

  useEffect(() => {
    let mounted = true;

    void browserRuntime
      .runPromise(loadInterfaceDocument({ safeMode }))
      .then((nextDocument) => {
        if (mounted) {
          setDocument(nextDocument);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  return <Launcher document={document} safeMode={safeMode} session={session} />;
}
