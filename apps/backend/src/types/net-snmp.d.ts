/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Minimal ambient types for the `net-snmp` package (it ships none) — only the
 * surface the SNMP service uses: createSession + get, the version constants, and
 * the varbind-error guard.
 */
declare module "net-snmp" {
  export const Version1: number;
  export const Version2c: number;

  export interface Varbind {
    oid: string;
    type: number;
    value: unknown;
  }

  export interface Session {
    get(oids: string[], callback: (error: Error | null, varbinds: Varbind[]) => void): void;
    subtree(
      oid: string,
      feedCallback: (varbinds: Varbind[]) => void,
      doneCallback: (error: Error | null) => void,
    ): void;
    close(): void;
  }

  export interface SessionOptions {
    version?: number;
    timeout?: number;
    retries?: number;
    port?: number;
  }

  export function createSession(target: string, community: string, options?: SessionOptions): Session;
  export function isVarbindError(varbind: Varbind): boolean;

  const _default: {
    Version1: number;
    Version2c: number;
    createSession: typeof createSession;
    isVarbindError: typeof isVarbindError;
  };
  export default _default;
}
