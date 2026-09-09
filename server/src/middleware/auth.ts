import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

function jwtSecret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET env var is not set');
  return s;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

// Augment Express Request with the decoded user, set by requireAuth.
declare global {
  namespace Express {
    interface Request { user?: AuthUser }
  }
}

export function signToken(user: AuthUser): string {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name, role: user.role },
    jwtSecret(),
    { expiresIn: '30d' }
  );
}

/**
 * The signed-in user, or null — never throws and never writes a response.
 *
 * Routes that are reachable without an account (the share-link read paths) need
 * to know *whether* a session exists without 401ing on its own; requireAuth
 * answers the response itself, so it can't be reused there. An unset JWT_SECRET
 * degrades to "not signed in" rather than a 500, because these callers have a
 * second way in (the break-glass link password).
 */
export function readAuthUser(req: Request): AuthUser | null {
  try {
    const token: string | undefined = req.cookies?.gsoc_auth;
    if (!token) return null;
    return jwt.verify(token, jwtSecret()) as AuthUser;
  } catch {
    return null;
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token: string | undefined = req.cookies?.gsoc_auth;
  if (!token) { res.status(401).json({ error: 'Not authenticated' }); return; }
  try {
    req.user = jwt.verify(token, jwtSecret()) as AuthUser;
    next();
  } catch {
    res.status(401).json({ error: 'Session expired — please sign in again' });
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  requireAuth(req, res, () => {
    if (req.user?.role !== 'admin') {
      res.status(403).json({ error: 'Admin access required' });
      return;
    }
    next();
  });
}

export const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  path: '/',
};
