import { z } from "zod";

export const interfaceDocumentSchema = z
  .object({
    version: z.literal(1),
    headline: z.string().trim().min(1).max(80),
    placeholder: z.string().trim().min(1).max(120),
    secondaryActions: z.array(z.enum(["open", "extensions", "connect"])).max(3),
  })
  .strict();

export type InterfaceDocument = z.infer<typeof interfaceDocumentSchema>;

const builtInInterfaceDocument: InterfaceDocument = {
  version: 1,
  headline: "What should we shape?",
  placeholder: "Build, change, or connect anything",
  secondaryActions: ["open", "extensions", "connect"],
};

export const defaultInterfaceDocument = Object.freeze(builtInInterfaceDocument);

export function parseInterfaceDocument(
  raw: string | null | undefined,
): InterfaceDocument {
  if (!raw) {
    return defaultInterfaceDocument;
  }

  try {
    const parsed = interfaceDocumentSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : defaultInterfaceDocument;
  } catch {
    return defaultInterfaceDocument;
  }
}
