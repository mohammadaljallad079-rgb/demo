'use client';

import { useEffect, useRef, useState } from 'react';
import type { AttachmentDto } from '@oryx/shared';
import type { AttachmentFieldHandle } from '@/components/attachments';
import { api } from '@/lib/api';

/**
 * Wires a create/edit form to the shared attachment field.
 *
 * Every section's form uses the same pieces: a list, a handle that uploads the
 * picked files once the record id exists, and a reset. Keeping them in one hook
 * means a new form supports attachments in three lines and cannot forget to
 * flush — the failure mode that would silently drop the user's files.
 *
 *   const attach = useFormAttachments();
 *   const created = await api.createThing(...);
 *   await attach.flush(created.id);
 *
 * An edit form passes `entityType` and the record id, so the hook seeds the
 * list with the attachments already on file. Without that the form would show
 * an empty list for a record that has files, and a save would look like it had
 * removed them.
 */
export function useFormAttachments(options?: {
  entityType?: string;
  entityId?: string | null;
}): {
  items: AttachmentDto[];
  setItems: (next: AttachmentDto[]) => void;
  register: (handle: AttachmentFieldHandle | null) => void;
  flush: (entityId?: string) => Promise<AttachmentDto[]>;
  reset: () => void;
} {
  const entityType = options?.entityType;
  const entityId = options?.entityId ?? null;
  const [items, setItems] = useState<AttachmentDto[]>([]);
  const ref = useRef<AttachmentFieldHandle | null>(null);

  useEffect(() => {
    if (!entityType || !entityId) {
      setItems([]);
      return;
    }
    let cancelled = false;
    api
      .attachments(entityType, entityId)
      .then((res) => {
        if (!cancelled) setItems(res.items);
      })
      // A caller without the read right sees an empty list rather than a
      // broken form; the API is what refuses the write.
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [entityType, entityId]);

  return {
    items,
    setItems,
    register: (handle) => {
      ref.current = handle;
    },
    flush: async (target) => (ref.current ? ref.current.flush(target) : []),
    reset: () => {
      ref.current?.discard();
      // A create form starts empty for the next record; an edit form keeps the
      // rows it just saved, which are on file.
      if (!entityId) setItems([]);
    },
  };
}
