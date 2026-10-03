import { z } from "zod";

export const supportedCurrencies = Intl.supportedValuesOf("currency");
export const sheetIdSchema = z.uuid("Choose a valid sheet.");
export const createSheetSchema = z.object({
  name: z.string().trim().min(1, "Enter a sheet name.").max(80, "Use 80 characters or fewer."),
  currency: z.string().refine((value) => supportedCurrencies.includes(value), "Choose a supported currency."),
});
export const referencesSchema = z.array(z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("category"), id: z.uuid() }),
  z.object({ kind: z.literal("bucket"), id: z.uuid() }),
])).max(100);
