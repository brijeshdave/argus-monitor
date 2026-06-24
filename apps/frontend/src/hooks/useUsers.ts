/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Users admin data hook: lists users, exposes create/update/delete and the
 * group-membership write. All fetching lives here; the page stays presentational.
 */
import { useCallback, useEffect, useState } from "react";
import type { Attribute } from "@argus/shared";
import { api } from "@/lib/api";

interface ListResponse<T> {
  rows: T[];
}

/** A user as returned by GET /api/users. Secrets are never serialized. */
export interface User {
  id: string;
  username: string;
  displayName: string | null;
  email: string | null;
  disabled: boolean;
  isOwner: boolean;
  isSystem: boolean;
  authProvider: string;
  createdAt: string;
  groupIds: string[];
  attributes: Attribute[];
}

/** Group reference for the membership multi-select (roleIds drive the effective
 * permissions preview in the editor). */
export interface GroupRef {
  id: string;
  name: string;
  roleIds: string[];
}

/** Role summary for the effective-permissions preview (group roles → permissions). */
export interface RoleSummary {
  id: string;
  name: string;
  permissions: string[];
}

export interface CreateUserInput {
  username: string;
  password: string;
  displayName?: string;
  email?: string;
  groupIds?: string[];
  attributes?: Attribute[];
}

export interface UpdateUserInput {
  displayName?: string;
  email?: string;
  disabled?: boolean;
  password?: string;
}

interface UseUsers {
  loading: boolean;
  error: string | null;
  users: User[];
  groups: GroupRef[];
  roles: RoleSummary[];
  reload: () => void;
  createUser: (input: CreateUserInput) => Promise<void>;
  updateUser: (id: string, input: UpdateUserInput) => Promise<void>;
  deleteUser: (id: string) => Promise<void>;
  setUserGroups: (id: string, groupIds: string[]) => Promise<void>;
  setUserAttributes: (id: string, attributes: Attribute[]) => Promise<void>;
  resetTwoFA: (id: string) => Promise<void>;
}

export function useUsers(): UseUsers {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [groups, setGroups] = useState<GroupRef[]>([]);
  const [roles, setRoles] = useState<RoleSummary[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [u, g, r] = await Promise.all([
        api.get<ListResponse<User>>("/api/users"),
        api.get<ListResponse<GroupRef>>("/api/groups"),
        api.get<ListResponse<RoleSummary>>("/api/roles"),
      ]);
      setUsers(u.rows);
      setGroups(g.rows);
      setRoles(r.rows);
    } catch {
      setError("Failed to load users.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const createUser = useCallback(
    async (input: CreateUserInput) => {
      await api.post("/api/users", input);
      await load();
    },
    [load],
  );

  const updateUser = useCallback(
    async (id: string, input: UpdateUserInput) => {
      await api.patch(`/api/users/${id}`, input);
      await load();
    },
    [load],
  );

  const deleteUser = useCallback(
    async (id: string) => {
      await api.del(`/api/users/${id}`);
      await load();
    },
    [load],
  );

  const setUserGroups = useCallback(
    async (id: string, groupIds: string[]) => {
      await api.put(`/api/users/${id}/groups`, { groupIds });
      await load();
    },
    [load],
  );

  const setUserAttributes = useCallback(
    async (id: string, attributes: Attribute[]) => {
      await api.put(`/api/users/${id}/attributes`, { attributes });
      await load();
    },
    [load],
  );

  const resetTwoFA = useCallback(async (id: string) => {
    await api.post(`/api/users/${id}/2fa/reset`);
  }, []);

  return {
    loading,
    error,
    users,
    groups,
    roles,
    reload: () => void load(),
    createUser,
    updateUser,
    deleteUser,
    setUserGroups,
    setUserAttributes,
    resetTwoFA,
  };
}
