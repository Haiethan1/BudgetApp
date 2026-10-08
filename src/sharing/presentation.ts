import { z } from "zod";
export const identitySchema = z.object({ id: z.string(), name: z.string(), username: z.string().nullable() });
export const searchResultsSchema = z.object({ people: z.array(identitySchema) });
export const sharingPageSchema = z.object({
  people: z.array(identitySchema.extend({ role: z.enum(["owner", "member"]) })),
  invites: z.array(z.object({ id: z.uuid(), inviteeId: z.string(), name: z.string(), username: z.string().nullable(), state: z.literal("pending"), createdAt: z.string() })),
});
export const incomingSchema = z.object({ invites: z.array(z.object({ id: z.uuid(), sheetId: z.uuid(), sheetName: z.string(), inviterName: z.string(), inviterUsername: z.string().nullable(), state: z.literal("pending"), createdAt: z.string() })) });
export type IncomingInvite = z.infer<typeof incomingSchema>["invites"][number];
export const availableSheetsSchema = z.object({ sheets: z.array(z.object({ id: z.uuid(), name: z.string(), currency: z.string(), role: z.enum(["owner", "member"]) })) });
export async function responseMessage(response: Response, fallback: string) {
  const parsed = z.object({ message: z.string() }).safeParse(await response.json().catch(() => null));
  return parsed.success ? parsed.data.message : fallback;
}
