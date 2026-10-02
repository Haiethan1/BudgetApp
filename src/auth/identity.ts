import { z } from "zod";

export const passwordRule = "Use 12 to 128 characters.";
export const passwordSchema = z.string().min(12, passwordRule).max(128, passwordRule);
export const identitySchema = z.object({
  name: z.string().trim().min(1, "Enter a display name.").max(80, "Use 80 characters or fewer."),
  username: z.string().trim().min(3, "Use 3 to 30 characters.").max(30, "Use 3 to 30 characters.")
    .regex(/^[a-zA-Z0-9_.]+$/, "Use letters, numbers, underscores, or periods."),
  email: z.email("Enter a valid email.").max(254).transform((value) => value.toLowerCase()),
  password: passwordSchema,
});
