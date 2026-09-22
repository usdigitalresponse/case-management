// Express 4 doesn't forward a rejected promise from an async handler to
// error middleware on its own; this wrapper does, so every route below can
// just `throw`/reject instead of hand-rolling try/catch + next(err).
import type { NextFunction, Request, RequestHandler, Response } from 'express';

export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
