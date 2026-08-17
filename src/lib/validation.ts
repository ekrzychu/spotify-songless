import { z } from "zod";
import { CATEGORY_IDS } from "@/lib/catalog/category-config";
import { DIFFICULTIES } from "@/types/game";

export const filterSchema = z.object({
  category: z.enum(CATEGORY_IDS as [string, ...string[]]),
  difficulty: z.enum(DIFFICULTIES),
});

export const roundIdSchema = z.string().cuid();
export const spotifyTrackIdSchema = z.string().regex(/^[A-Za-z0-9]{22}$/);
