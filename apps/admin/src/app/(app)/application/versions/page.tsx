'use client';

import { PermissionGate } from '@/components/permission-gate';
import { useState } from 'react';
import type { AppVersionDto } from '@oryx/shared';
import { api } from '@/lib/api';
import { useUi } from '@/lib/ui-context';
import { useAsync } from '@/lib/hooks';
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

function AppVersionsPageInner() {
  const { t } = useUi();
  const versions = useAsync(() => api.appVersions(), []);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    platform: 'IOS',
    version: '',
    buildNumber: '1',
    minSupportedVersion: '',
    releaseNotes: '',
    isActive: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewOf, setPreviewOf] = useState<AppVersionDto | null>(null);
  const attach = useFormAttachments();

  return (
    <div className="flex flex-col gap-5" data-testid="app-versions-page">
      <SectionHeader
        title={t('app.versions')}
        subtitle={t('app.subtitle')}
        actions={
          <>
            <Button size="sm" onClick={() => void versions.reload()}>
              <Icon name="search" size={15} />
              {t('common.refresh')}
            </Button>
            <Button variant="primary" onClick={() => setOpen(true)} data-testid="new-app-version">
              <Icon name="plus" size={16} />
              {t('app.newVersion')}
            </Button>
          </>
        }
      />

      <p
        className="m-0 flex items-start gap-2 rounded-xl border px-4 py-3 text-[12.5px]"
        style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
      >
        <span className="oryx-gold mt-[2px]">
          <Icon name="info" size={15} />
        </span>
        <span className="oryx-muted">{t('app.notImplemented')}</span>
      </p>

      {versions.error ? (
        <ErrorBanner message={versions.error} onRetry={versions.reload} retryLabel={t('common.retry')} />
      ) : null}

      <Card data-testid="versions-table">
        {versions.loading ? (
          <div className="p-4">
            <Skeleton height={80} />
          </div>
        ) : (versions.data?.length ?? 0) === 0 ? (
          <EmptyState title={t('common.empty')} hint={t('common.emptyHint')} />
        ) : (
          <TableShell>
            <thead>
              <tr>
                <th>{t('app.platform')}</th>
                <th>{t('app.version')}</th>
                <th>{t('app.build')}</th>
                <th>{t('app.minSupported')}</th>
                <th>{t('common.status')}</th>
                <th>{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {versions.data!.map((v, i) => (
                <tr key={String(v.id ?? i)}>
                  <td>
                    <Badge tone="info">{String(v.platform)}</Badge>
                  </td>
                  <td className="font-mono text-[12px]">{String(v.version)}</td>
                  <td className="font-mono text-[12px]">{String(v.buildNumber)}</td>
                  <td className="font-mono text-[12px]">{String(v.minSupportedVersion)}</td>
                  <td>
                    <Badge tone={v.isActive ? 'success' : 'neutral'}>
                      {v.isActive ? t('common.active') : t('common.inactive')}
                    </Badge>
                  </td>
                  <td>
                    <Button size="sm" onClick={() => setPreviewOf(v)} data-testid={`preview-version-${String(v.version)}`}>
                      {t('attach.preview')}
                    </Button>
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
        title={previewOf ? `${previewOf.platform} ${previewOf.version}` : ''}
        subtitle={previewOf ? `build ${previewOf.buildNumber}` : undefined}
        entityType="APP_VERSION"
        entityId={previewOf?.id ?? null}
        testId="app-version-preview"
        fields={
          previewOf
            ? [
                { label: t('app.platform'), value: previewOf.platform },
                { label: t('app.version'), value: previewOf.version },
                { label: t('app.build'), value: previewOf.buildNumber },
                { label: t('app.minSupported'), value: previewOf.minSupportedVersion },
                { label: t('common.status'), value: previewOf.isActive ? t('common.active') : t('common.inactive') },
                { label: t('app.releaseNotes'), value: previewOf.releaseNotes ?? '—' },
              ]
            : []
        }
      />

      <Modal
        open={open}
        title={t('app.newVersion')}
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button
              variant="primary"
              disabled={busy || !form.version || !form.minSupportedVersion}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  const saved = await api.upsertAppVersion(form);
                  await attach.flush(String(saved.id));
                  attach.reset();
                  setOpen(false);
                  await versions.reload();
                } catch (err) {
                  setError(err instanceof Error ? err.message : t('common.error'));
                } finally {
                  setBusy(false);
                }
              }}
              data-testid="save-app-version"
            >
              {busy ? t('common.loading') : t('common.save')}
            </Button>
          </>
        }
      >
        {error ? (
          <p
            className="mb-3 rounded-lg px-3 py-2 text-[12.5px] font-semibold"
            style={{ color: 'var(--danger)', background: 'color-mix(in srgb, var(--danger) 12%, transparent)' }}
          >
            {error}
          </p>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('app.platform')} required>
            <select
              className="oryx-select"
              value={form.platform}
              onChange={(e) => setForm({ ...form, platform: e.target.value })}
              data-testid="version-platform"
            >
              <option value="IOS">iOS</option>
              <option value="ANDROID">Android</option>
            </select>
          </Field>
          <Field label={t('app.version')} required>
            <input
              className="oryx-input"
              value={form.version}
              onChange={(e) => setForm({ ...form, version: e.target.value })}
              placeholder="0.1.0"
              data-testid="version-number"
            />
          </Field>
          <Field label={t('app.build')} required>
            <input
              className="oryx-input"
              value={form.buildNumber}
              onChange={(e) => setForm({ ...form, buildNumber: e.target.value })}
            />
          </Field>
          <Field label={t('app.minSupported')} required>
            <input
              className="oryx-input"
              value={form.minSupportedVersion}
              onChange={(e) => setForm({ ...form, minSupportedVersion: e.target.value })}
              placeholder="0.1.0"
              data-testid="version-min"
            />
          </Field>
        </div>
        <label className="mt-4 flex items-center gap-2 text-[12.5px] font-semibold">
          <input
            type="checkbox"
            className="oryx-checkbox"
            checked={form.isActive}
            onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
          />
          {t('common.active')}
        </label>
        <div className="mt-4 border-t border-[var(--border)] pt-3">
          <AttachmentField
            entityType="APP_VERSION"
            entityId={null}
            value={attach.items}
            onChange={attach.setItems}
            registerFlush={attach.register}
            canWrite
            label={t('app.versionAttachments')}
            hint={t('app.versionAttachmentsHint')}
            testId="app-version-attachments"
          />
        </div>
      </Modal>
    </div>
  );
}

export default function Page() {
  return (
    <PermissionGate anyOf={['platform.api.manage']}>
      <AppVersionsPageInner />
    </PermissionGate>
  );
}
