import { z } from "zod";
export const organizationName = z.string().trim().min(1, "Enter a name.").max(80, "Use 80 characters or fewer.")
  .refine((name) => !/[\u0000-\u001f\u007f]/.test(name), "Use a name without control characters.");
export const sourceTypes = { bank: "Bank account", credit_card: "Credit card", cash: "Cash", other: "Other" };
export const sourceTypeSchema = z.enum(["bank", "credit_card", "cash", "other"]);
export const organizationKind = z.enum(["account", "category", "bucket"]);
export const settingsMutation = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("create"), entity: organizationKind, name: organizationName, sourceType: sourceTypeSchema.optional() }),
  z.object({ kind: z.literal("rename"), entity: organizationKind, id: z.uuid(), name: organizationName }),
  z.object({ kind: z.literal("archive"), entity: organizationKind, id: z.uuid() }),
  z.object({ kind: z.literal("restore"), entity: organizationKind, id: z.uuid() }),
  z.object({ kind: z.literal("renameSheet"), name: organizationName }),
  z.object({ kind: z.literal("deleteSheet"), confirmation: z.string() }),
]);
export const displayNameSchema = z.object({ name: organizationName });

