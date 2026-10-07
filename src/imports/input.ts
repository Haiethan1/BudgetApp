import { z } from "zod";
export const importLimits = { fileBytes: 2 * 1024 * 1024, rows: 5000, columns: 100, cellCharacters: 10000 };
const column = z.string().trim().min(1).max(200);
export const mappingSchema = z.object({
  version: z.literal(1), profile: z.string().trim().min(1).max(80),
  date: column, payee: column, sourceId: column.optional(),
  dateFormat: z.enum(["YYYY-MM-DD", "MM/DD/YYYY", "DD/MM/YYYY"]),
  decimalSeparator: z.enum([".", ","]),
  money: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("signed"), amount: column, outflowSign: z.enum(["negative", "positive"]) }),
    z.object({ mode: z.literal("debit-credit"), debit: column, credit: column, unused: z.enum(["blank", "blank-or-zero"]) }),
  ]),
}).strict();
export type Mapping = z.infer<typeof mappingSchema>;


