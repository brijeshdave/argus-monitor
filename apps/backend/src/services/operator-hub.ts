/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * In-memory registry of connected operator (and wallboard) live sockets. Single-
 * node only; for multi-instance, live fan-out moves to Redis pub/sub (ADR-0005).
 * Unlike AgentHub this keys nothing — every connected operator receives every
 * broadcast (snapshot on connect, patches on ingest).
 */
import type { LiveMessage } from "@argus/shared";

interface Sendable {
  send(data: string): void;
  readyState: number;
}

export class OperatorHub {
  private readonly sockets = new Set<Sendable>();

  add(socket: Sendable): void {
    this.sockets.add(socket);
  }

  remove(socket: Sendable): void {
    this.sockets.delete(socket);
  }

  /** Fan a live message out to every connected, open operator socket. */
  broadcast(msg: LiveMessage): void {
    const data = JSON.stringify(msg);
    for (const socket of this.sockets) {
      if (socket.readyState === 1 /* OPEN */) socket.send(data);
    }
  }
}
