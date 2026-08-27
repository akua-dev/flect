import { type ClassValue, clsx } from "clsx";

export const cn = (...inputs: ReadonlyArray<ClassValue>) => clsx(inputs);
