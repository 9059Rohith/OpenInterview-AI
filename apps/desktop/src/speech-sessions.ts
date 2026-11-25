export interface ManagedSpeechSession {
  start(): Promise<void>;
  stop(): Promise<void>;
  cancel(): void;
}

/** Tracks connection identity as well as the renderer's reusable request ID. */
export class SpeechSessions<Owner, Session extends ManagedSpeechSession> {
  private sessions = new Map<string, {session: Session; owner: Owner; source: 'PC' | 'MIC'}>();

  owned(id: string, owner: Owner) {
    const active = this.sessions.get(id);
    if (!active || active.owner !== owner) throw new Error('No realtime speech session owned by this window');
    return active;
  }

  async start(id: string, owner: Owner, source: 'PC' | 'MIC', create: () => Session): Promise<void> {
    if (this.sessions.has(id) || this.sessions.size >= 4 ||
        [...this.sessions.values()].some(item => item.owner === owner && item.source === source)) {
      throw new Error('This audio source already has an active realtime session');
    }
    const active = {session: create(), owner, source};
    this.sessions.set(id, active);
    try {
      await active.session.start();
    } catch (error) {
      this.remove(id, active);
      active.session.cancel();
      throw error;
    }
  }

  async stop(id: string, owner: Owner): Promise<void> {
    const active = this.owned(id, owner);
    try { await active.session.stop(); }
    finally { this.remove(id, active); }
  }

  cancel(id: string, owner: Owner): void {
    const active = this.owned(id, owner);
    this.remove(id, active);
    active.session.cancel();
  }

  cancelOwned(owner: Owner): void {
    for (const [id, active] of this.sessions) {
      if (active.owner !== owner) continue;
      this.remove(id, active);
      active.session.cancel();
    }
  }

  cancelAll(): void {
    for (const [id, active] of this.sessions) {
      this.remove(id, active);
      active.session.cancel();
    }
  }

  private remove(id: string, active: {session: Session; owner: Owner; source: 'PC' | 'MIC'}): void {
    // Cancellation permits immediate ID reuse; an earlier await must not remove its replacement.
    if (this.sessions.get(id) === active) this.sessions.delete(id);
  }
}
