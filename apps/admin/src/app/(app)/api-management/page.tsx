'use client';

import { PermissionGate } from '@/components/permission-gate';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useUi } from '@/lib/ui-context';
import { useAsync } from '@/lib/hooks';
import type { ApiClientDto } from '@oryx/shared';
import { useFormAttachments } from '@/lib/use-form-attachments';
import { AttachmentField } from '@/components/attachments';
import { RecordPreview } from '@/components/record-preview';
import { Icon } from '@/components/icons';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  Field,
  Modal,
  SectionHeader,
  Skeleton,
  TableShell,
} from '@/components/ui';

function ApiManagementPageInner() {
  const { t } = useUi();
  const clients = useAsync(() => api.apiClients(), []);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', rateLimitPerMinute: 60, scopes: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ clientId: string; secret: string } | null>(null);
  const [previewOf, setPreviewOf] = useState<ApiClientDto | null>(null);
  const attach = useFormAttachments();

  return (
    <div className="flex flex-col gap-5" data-testid="api-management-page">
      <SectionHeader
        title={t('nav.apiClients')}
        subtitle={t('app.subtitle')}
        actions={
          <>
            <Button size="sm" onClick={() => void clients.reload()}>
              <Icon name="search" size={15} />
              {t('common.refresh')}
            </Button>
            <Button variant="primary" onClick={() => setOpen(true)} data-testid="new-api-client">
              <Icon name="plus" size={16} />
              {t('app.newClient')}
            </Button>
          </>
        }
      />

      <Card className="p-4">
        <p className="oryx-panel-title m-0 mb-1">Versioned API</p>
        <p className="oryx-muted m-0 text-[12.5px]">
          All endpoints are served under <code className="font-mono">/api/v1</code>. Interactive
          documentation is generated from the NestJS controllers at{' '}
          <code className="font-mono">/api/docs</code>. Client secrets are hashed with SHA-256 and
          returned exactly once at registration.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge tone="gold">/api/v1/auth</Badge>
          <Badge tone="gold">/api/v1/companies</Badge>
          <Badge tone="gold">/api/v1/modules</Badge>
          <Badge tone="gold">/api/v1/plans</Badge>
          <Badge tone="gold">/api/v1/subscriptions</Badge>
          <Badge tone="gold">/api/v1/dashboard</Badge>
          <Badge tone="gold">/api/v1/cms</Badge>
          <Badge tone="gold">/api/v1/audit-logs</Badge>
        </div>
      </Card>

      {clients.error ? (
        <ErrorBanner message={clients.error} onRetry={clients.reload} retryLabel={t('common.retry')} />
      ) : null}

      <Card data-testid="api-clients-table">
        {clients.loading ? (
          <div className="p-4">
            <Skeleton height={80} />
          </div>
        ) : (clients.data?.length ?? 0) === 0 ? (
          <EmptyState title={t('common.empty')} hint={t('common.emptyHint')} />
        ) : (
          <TableShell>
            <thead>
              <tr>
                <th>{t('common.name')}</th>
                <th>{t('app.clientId')}</th>
                <th>{t('app.rateLimit')}</th>
                <th>{t('common.status')}</th>
                <th>{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {clients.data!.map((c, i) => (
                <tr key={String(c.id ?? i)}>
                  <td className="font-semibold">{String(c.name)}</td>
                  <td className="font-mono text-[11.5px]">{String(c.clientId)}</td>
                  <td className="tabular-nums">{String(c.rateLimitPerMinute)}</td>
                  <td>
                    <Badge tone={c.isActive ? 'success' : 'danger'}>
                      {c.isActive ? t('common.active') : t('common.inactive')}
                    </Badge>
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" onClick={() => setPreviewOf(c)} data-testid={`preview-api-client-${String(c.clientId)}`}>
                        {t('attach.preview')}
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={!c.isActive}
                        onClick={async () => {
                          // Routed through the API client so it carries the
                          // Authorization header and the CSRF token.
                          await api.revokeApiClient(String(c.id));
                          await clients.reload();
                        }}
                      >
                        {t('users.revoke')}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </Card>

      <RecordPreview
        open={previewOf !== null}
        onClose={() => setPreviewOf(null)}
        title={previewOf ? previewOf.name : ''}
        subtitle={previewOf?.clientId}
        entityType="API_CLIENT"
        entityId={previewOf?.id ?? null}
        testId="api-client-preview"
        fields={
          previewOf
            ? [
                { label: t('common.name'), value: previewOf.name },
                { label: t('app.clientId'), value: previewOf.clientId },
                { label: t('app.rateLimit'), value: String(previewOf.rateLimitPerMinute) },
                { label: t('app.scopes'), value: previewOf.scopes.join(', ') || '—' },
                { label: t('common.status'), value: previewOf.isActive ? t('common.active') : t('common.inactive') },
              ]
            : []
        }
      />

      <Modal
        open={open}
        title={t('app.newClient')}
        onClose={() => {
          setOpen(false);
          setCreated(null);
        }}
        footer={
          created ? (
            <Button
              variant="primary"
              onClick={() => {
                setOpen(false);
                setCreated(null);
              }}
            >
              {t('common.close')}
            </Button>
          ) : (
            <>
              <Button onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
              <Button
                variant="primary"
                disabled={busy || !form.name}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    const res = await api.createApiClient({
                      name: form.name,
                      rateLimitPerMinute: form.rateLimitPerMinute,
                      scopes: form.scopes
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean),
                    });
                    setCreated({ clientId: String(res.clientId), secret: String(res.secret) });
                    await attach.flush(String(res.id));
                    attach.reset();
                    await clients.reload();
                  } catch (err) {
                    setError(err instanceof Error ? err.message : t('common.error'));
                  } finally {
                    setBusy(false);
                  }
                }}
                data-testid="save-api-client"
              >
                {busy ? t('common.loading') : t('common.create')}
              </Button>
            </>
          )
        }
      >
        {created ? (
          <div>
            <p className="oryx-panel-title m-0">{t('app.secretOnce')}</p>
            <dl className="mt-3 grid gap-2 text-[12.5px]">
              <div>
                <dt className="oryx-faint">{t('app.clientId')}</dt>
                <dd className="m-0 font-mono">{created.clientId}</dd>
              </div>
              <div>
                <dt className="oryx-faint">Secret</dt>
                <dd
                  className="m-0 break-all rounded-lg px-3 py-2 font-mono"
                  style={{ background: 'var(--surface-raised)', border: '1px solid var(--border-strong)' }}
                  data-testid="api-secret"
                >
                  {created.secret}
                </dd>
              </div>
            </dl>
          </div>
        ) : (
          <>
            {error ? (
              <p
                className="mb-3 rounded-lg px-3 py-2 text-[12.5px] font-semibold"
                style={{ color: 'var(--danger)', background: 'color-mix(in srgb, var(--danger) 12%, transparent)' }}
              >
                {error}
              </p>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('common.name')} required>
                <input
                  className="oryx-input"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  data-testid="api-client-name"
                />
              </Field>
              <Field label={t('app.rateLimit')}>
                <input
                  className="oryx-input"
                  type="number"
                  min={1}
                  value={form.rateLimitPerMinute}
                  onChange={(e) => setForm({ ...form, rateLimitPerMinute: Number(e.target.value) })}
                />
              </Field>
              <div className="sm:col-span-2">
                <Field label={t('app.scopes')} hint="Comma separated">
                  <input
                    className="oryx-input"
                    value={form.scopes}
                    onChange={(e) => setForm({ ...form, scopes: e.target.value })}
                  />
                </Field>
              </div>
              <div className="sm:col-span-2 border-t border-[var(--border)] pt-3">
                <AttachmentField
                  entityType="API_CLIENT"
                  entityId={null}
                  value={attach.items}
                  onChange={attach.setItems}
                  registerFlush={attach.register}
                  canWrite
                  label={t('app.clientAttachments')}
                  hint={t('app.clientAttachmentsHint')}
                  testId="api-client-attachments"
                />
              </div>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}

export default function Page() {
  return (
    <PermissionGate anyOf={['platform.api.manage']}>
      <ApiManagementPageInner />
    </PermissionGate>
  );
}
