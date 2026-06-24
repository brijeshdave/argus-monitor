/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * In-memory registry of connected agent control sockets. Single-node only; for
 * multi-instance, command fan-out moves to Redis pub/sub (ADR-0005). Lets the
 * backend push commands to an agent the moment it is connected.
 */
import type { ServerToAgent } from "@argus/shared";

interface Sendable {
  send(data: string): void;
  readyState: number;
}

export class AgentHub {
  private readonly sockets = new Map<string, Sendable>();

  add(agentId: string, socket: Sendable): void {
    this.sockets.set(agentId, socket);
  }

  remove(agentId: string): void {
    this.sockets.delete(agentId);
  }

  isOnline(agentId: string): boolean {
    return this.sockets.has(agentId);
  }

  /** Send a message if the agent is connected and its socket is open. */
  send(agentId: string, msg: ServerToAgent): boolean {
    const socket = this.sockets.get(agentId);
    if (!socket || socket.readyState !== 1 /* OPEN */) return false;
    socket.send(JSON.stringify(msg));
    return true;
  }
}
