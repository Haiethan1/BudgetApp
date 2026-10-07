import { z } from "zod";

export const searchInput = z.string().trim().min(2, "Enter at least two characters.").max(80);
const userId = z.string().min(1).max(128);
export const sharingInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("invite"), userId }),
  z.object({ kind: z.literal("revokeInvite"), inviteId: z.uuid() }),
  z.object({ kind: z.literal("removeMember"), userId }),
  z.object({ kind: z.literal("leave") }),
]);
export const responseInput = z.object({ kind: z.enum(["accept", "decline"]) });
