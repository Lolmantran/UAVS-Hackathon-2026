import { randomUUID } from "node:crypto";
import type { Session } from "../types/pipeline.js";

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes — demo-scoped, not a production policy

const sessions = new Map<string, Session>();

function sweepExpired(): void {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.createdAt > SESSION_TTL_MS) {
      sessions.delete(id);
    }
  }
}

export function createSession(init: Omit<Session, "id" | "createdAt">): Session {
  sweepExpired();
  const session: Session = { ...init, id: randomUUID(), createdAt: Date.now() };
  sessions.set(session.id, session);
  return session;
}

export function getSession(id: string): Session | undefined {
  sweepExpired();
  return sessions.get(id);
}

export function updateSession(id: string, patch: Partial<Omit<Session, "id" | "createdAt">>): Session {
  const existing = sessions.get(id);
  if (!existing) {
    throw new Error(`Unknown or expired session_id: ${id}`);
  }
  const updated: Session = { ...existing, ...patch };
  sessions.set(id, updated);
  return updated;
}
