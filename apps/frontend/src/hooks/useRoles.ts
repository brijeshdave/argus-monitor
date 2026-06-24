/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Roles admin data hook: lists roles with their permission keys plus the full
 * permission catalogue, and exposes create/update/delete + the permission write.
 */
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

interface ListResponse<T> {
  rows: T[];
}

/** A role as returned by GET /api/roles. Roles carry the permission keys. */
export interface Role {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: string[];
}

/** A permission from the catalogue (GET /api/permissions). */
export interface Permission {
  id: string;
  key: string;
  description: string | null;
}

export interface CreateRoleInput {
  name: string;
  description?: string;
  permissionKeys?: string[];
}

export interface UpdateRoleInput {
  name?: string;
  description?: string;
}

interface UseRoles {
  loading: boolean;
  error: string | null;
  roles: Role[];
  permissions: Permission[];
  reload: () => void;
  createRole: (input: CreateRoleInput) => Promise<void>;
  updateRole: (id: string, input: UpdateRoleInput) => Promise<void>;
  deleteRole: (id: string) => Promise<void>;
  setRolePermissions: (id: string, permissionKeys: string[]) => Promise<void>;
}

export function useRoles(): UseRoles {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [r, p] = await Promise.all([
        api.get<ListResponse<Role>>("/api/roles"),
        api.get<ListResponse<Permission>>("/api/permissions"),
      ]);
      setRoles(r.rows);
      setPermissions(p.rows);
    } catch {
      setError("Failed to load roles.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const createRole = useCallback(
    async (input: CreateRoleInput) => {
      await api.post("/api/roles", input);
      await load();
    },
    [load],
  );

  const updateRole = useCallback(
    async (id: string, input: UpdateRoleInput) => {
      await api.patch(`/api/roles/${id}`, input);
      await load();
    },
    [load],
  );

  const deleteRole = useCallback(
    async (id: string) => {
      await api.del(`/api/roles/${id}`);
      await load();
    },
    [load],
  );

  const setRolePermissions = useCallback(
    async (id: string, permissionKeys: string[]) => {
      await api.put(`/api/roles/${id}/permissions`, { permissionKeys });
      await load();
    },
    [load],
  );

  return {
    loading,
    error,
    roles,
    permissions,
    reload: () => void load(),
    createRole,
    updateRole,
    deleteRole,
    setRolePermissions,
  };
}
