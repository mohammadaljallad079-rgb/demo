'use client';

import { PermissionGate } from '@/components/permission-gate';
import { useEffect, useState } from 'react';
import type { FeatureFlagDto } from '@oryx/shared';
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

function FeatureFlagsPageInner() {
  const { t, locale } = useUi();
  const flags = useAsync(() => api.featureFlags(), []);
  const [editing, setEditing] = useState<FeatureFlagDto | null>(null);
  const [creating, setCreating] = useState(false);
  const [previewOf, setPreviewOf] = useState<FeatureFlagDto | null>(null);

  return (
    <div className="flex flex-col gap-5" data-testid="feature-flags-page">
      <SectionHeader
        title={t('app.flags')}
        subtitle={t('app.subtitle')}
        actions={
          <>
            <Button size="sm" onClick={() => void flags.reload()}>
              <Icon name="search" size={15} />
              {t('common.refresh')}
            </Button>
            <Button variant="primary" onClick={() => setCreating(true)} data-testid="new-flag">
              <Icon name="plus" size={16} />
              {t('app.newFlag')}
            </Button>
          </>
        }
      />

      {flags.error ? <ErrorBanner message={flags.error} onRetry={flags.reload} retryLabel={t('common.retry')} /> : null}

      <Card data-testid="flags-table">
        {flags.loading ? (
          <div className="p-4">
            <Skeleton height={110} />
          </div>
        ) : (flags.data?.length ?? 0) === 0 ? (
          <EmptyState title={t('common.empty')} hint={t('common.emptyHint')} />
        ) : (
          <TableShell>
            <thead>
              <tr>
                <th>{t('common.code')}</th>
                <th>{t('common.name')}</th>
                <th>{t('app.audience')}</th>
                <th>{t('app.rollout')}</th>
                <th>{t('common.status')}</th>
                <th>{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {flags.data!.map((f) => (
                <tr key={f.id}>
                  <td className="font-mono text-[11.5px]">{f.key}</td>
                  <td className="font-semibold">{locale === 'ar' ? f.nameAr : f.nameEn}</td>
                  <td>{f.audience}</td>
                  <td className="tabular-nums">{f.rolloutPercentage}%</td>
                  <td>
                    <Badge tone={f.enabled ? 'success' : 'neutral'}>
                      {f.enabled ? t('app.enabled') : t('app.disabled')}
                    </Badge>
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" onClick={() => setPreviewOf(f)} data-testid={`preview-flag-${f.key}`}>
                        {t('attach.preview')}
                      </Button>
                      <Button size="sm" onClick={() => setEditing(f)}>
                        {t('common.edit')}
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
        title={previewOf ? (locale === 'ar' ? previewOf.nameAr : previewOf.nameEn) : ''}
        subtitle={previewOf?.key}
        entityType="FEATURE_FLAG"
        entityId={previewOf?.id ?? null}
        testId="feature-flag-preview"
        fields={
          previewOf
            ? [
                { label: t('common.code'), value: previewOf.key },
                { label: t('common.name'), value: `${previewOf.nameEn} / ${previewOf.nameAr}` },
                { label: t('app.audience'), value: previewOf.audience },
                { label: t('app.rollout'), value: `${previewOf.rolloutPercentage}%` },
                { label: t('common.status'), value: previewOf.enabled ? t('app.enabled') : t('app.disabled') },
                { label: t('common.description'), value: previewOf.description ?? '—' },
              ]
            : []
        }
      />

      <FlagEditor
        open={creating || Boolean(editing)}
        flag={editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSaved={async () => {
          setCreating(false);
          setEditing(null);
          await flags.reload();
        }}
      />
    </div>
  );
}

function FlagEditor({
  open,
  flag,
  onClose,
  onSaved,
}: {
  open: boolean;
  flag: FeatureFlagDto | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useUi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attach = useFormAttachments({ entityType: 'FEATURE_FLAG', entityId: flag?.id ?? null });
  const [form, setForm] = useState({
    key: '',
    nameEn: '',
    nameAr: '',
    description: '',
    enabled: false,
    audience: 'all',
    rolloutPercentage: 0,
  });

  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm(
      flag
        ? {
            key: flag.key,
            nameEn: flag.nameEn,
            nameAr: flag.nameAr,
            description: flag.description ?? '',
            enabled: flag.enabled,
            audience: flag.audience,
            rolloutPercentage: flag.rolloutPercentage,
          }
        : { key: '', nameEn: '', nameAr: '', description: '', enabled: false, audience: 'all', rolloutPercentage: 0 },
    );
  }, [open, flag]);

  return (
    <Modal
      open={open}
      title={flag ? `${t('common.edit')} — ${flag.key}` : t('app.newFlag')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            variant="primary"
            disabled={busy || !form.key || !form.nameEn || !form.nameAr}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const saved = await api.upsertFeatureFlag(form);
                await attach.flush(String(saved.id));
                attach.reset();
                await onSaved();
              } catch (err) {
                setError(err instanceof Error ? err.message : t('common.error'));
              } finally {
                setBusy(false);
              }
            }}
            data-testid="save-flag"
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
        <Field label={t('common.code')} required>
          <input
            className="oryx-input"
            value={form.key}
            readOnly={Boolean(flag)}
            disabled={Boolean(flag)}
            onChange={(e) => setForm({ ...form, key: e.target.value })}
            data-testid="flag-key"
          />
        </Field>
        <Field label={t('app.audience')}>
          <input
            className="oryx-input"
            value={form.audience}
            onChange={(e) => setForm({ ...form, audience: e.target.value })}
          />
        </Field>
        <Field label={`${t('common.name')} (EN)`} required>
          <input
            className="oryx-input"
            value={form.nameEn}
            onChange={(e) => setForm({ ...form, nameEn: e.target.value })}
            data-testid="flag-name-en"
          />
        </Field>
        <Field label={`${t('common.name')} (AR)`} required>
          <input
            className="oryx-input"
            value={form.nameAr}
            onChange={(e) => setForm({ ...form, nameAr: e.target.value })}
            data-testid="flag-name-ar"
          />
        </Field>
        <Field label={t('app.rollout')}>
          <input
            className="oryx-input"
            type="number"
            min={0}
            max={100}
            value={form.rolloutPercentage}
            onChange={(e) => setForm({ ...form, rolloutPercentage: Number(e.target.value) })}
          />
        </Field>
      </div>
      <label className="mt-4 flex items-center gap-2 text-[12.5px] font-semibold">
        <input
          type="checkbox"
          className="oryx-checkbox"
          checked={form.enabled}
          onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
          data-testid="flag-enabled"
        />
        {t('app.enabled')}
      </label>
      <div className="mt-4 border-t border-[var(--border)] pt-3">
        <AttachmentField
          entityType="FEATURE_FLAG"
          entityId={flag?.id ?? null}
          value={attach.items}
          onChange={attach.setItems}
          registerFlush={attach.register}
          canWrite
          label={t('app.flagAttachments')}
          hint={t('app.flagAttachmentsHint')}
          testId="flag-attachments"
        />
      </div>
    </Modal>
  );
}

export default function Page() {
  return (
    <PermissionGate anyOf={['platform.api.manage']}>
      <FeatureFlagsPageInner />
    </PermissionGate>
  );
}
