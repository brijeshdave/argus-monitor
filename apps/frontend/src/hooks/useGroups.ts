/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Groups admin data hook: lists groups with the role refs needed for the
 * role multi-select, plus create/update/delete and the role-assignment write.
 */
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

interface ListResponse<T> {
  rows: T[];
}

/** A group as returned by GET /api/groups. Access flows users → groups → roles. */
export interface Group {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  roleIds: string[];
}

/** Minimal role reference for the assignment multi-select. */
export interface RoleRef {
  id: string;
  name: string;
}

export interface CreateGroupInput {
  name: string;
  description?: string;
  roleIds?: string[];
}

export interface UpdateGroupInput {
  name?: string;
  description?: string;
}

interface UseGroups {
  loading: boolean;
  error: string | null;
  groups: Group[];
  roles: RoleRef[];
  reload: () => void;
  createGroup: (input: CreateGroupInput) => Promise<void>;
  updateGroup: (id: string, input: UpdateGroupInput) => Promise<void>;
  deleteGroup: (id: string) => Promise<void>;
  setGroupRoles: (id: string, roleIds: string[]) => Promise<void>;
}

export function useGroups(): UseGroups {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [roles, setRoles] = useState<RoleRef[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [g, r] = await Promise.all([
        api.get<ListResponse<Group>>("/api/groups"),
        api.get<ListResponse<RoleRef>>("/api/roles"),
      ]);
      setGroups(g.rows);
      setRoles(r.rows);
    } catch {
      setError("Failed to load groups.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const createGroup = useCallback(
    async (input: CreateGroupInput) => {
      await api.post("/api/groups", input);
      await load();
    },
    [load],
  );

  const updateGroup = useCallback(
    async (id: string, input: UpdateGroupInput) => {
      await api.patch(`/api/groups/${id}`, input);
      await load();
    },
    [load],
  );

  const deleteGroup = useCallback(
    async (id: string) => {
      await api.del(`/api/groups/${id}`);
      await load();
    },
    [load],
  );

  const setGroupRoles = useCallback(
    async (id: string, roleIds: string[]) => {
      await api.put(`/api/groups/${id}/roles`, { roleIds });
      await load();
    },
    [load],
  );

  return {
    loading,
    error,
    groups,
    roles,
    reload: () => void load(),
    createGroup,
    updateGroup,
    deleteGroup,
    setGroupRoles,
  };
}
