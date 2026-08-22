import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/**
 * The only place this service turns a thrown thing into a response body.
 *
 * Nothing internal crosses this boundary. A user of this product is often
 * dealing with immigration paperwork under time pressure on a phone; a raw
 * Postgres error string is not just a leak, it is unusable. Handlers throw,
 * this decides what the user is told.
 */
export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: "Some of that information was not valid",
      code: "validation/failed",
      details: err.errors.map((e) => ({ path: e.path.join("."), message: e.message })),
    });
  }

  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, code: err.code });
  }

  // body-parser rejects an oversized body before any handler runs, so a route's
  // own size check never gets the chance to produce a friendlier message.
  if ((err as { type?: string }).type === "entity.too.large") {
    return res.status(413).json({ error: "That file is too large to send", code: "upload/too-large" });
  }

  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Something went wrong on our end", code: "server/error" });
}

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: "Not found", code: "server/not-found" });
}
