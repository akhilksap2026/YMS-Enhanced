import { z } from "zod";
import type { Request, Response, NextFunction } from "express";
/** Reject a request body that does not match the schema with 422 and field messages. */
export const body = (s: z.ZodTypeAny) => (q: Request, r: Response, n: NextFunction) => {
  const p = s.safeParse(q.body ?? {});
  if (!p.success) return void r.status(422).json({ error: "Invalid input", issues: p.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
  q.body = p.data; n();
};
export const id = z.string().trim().min(1).max(64);
