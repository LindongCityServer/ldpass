'use client';

import { FormEvent, useEffect, useState } from 'react';
import { getJson, postJson } from '../../api-client';
import type { AccentTone } from '../../theme-provider';
import {
  cachePlatformThemeConfig,
  normalizePlatformThemeConfig,
  type PlatformThemeScheduleResponse,
} from '../../theme-config';

interface EditableThemeEntry {
  effectiveAt: string;
  tone: AccentTone;
  enabled: boolean;
  note: string;
}

const toneOptions: Array<{ value: AccentTone; label: string }> = [
  { value: 'teal', label: '青绿色' },
  { value: 'red', label: '红色' },
  { value: 'gray', label: '灰色' },
];

export function ThemeSchedulePanel({ embedded = false }: { embedded?: boolean } = {}) {
  const [entries, setEntries] = useState<EditableThemeEntry[]>([
    { effectiveAt: formatUtc8DateTimeInput(new Date()), tone: 'teal', enabled: true, note: '' },
  ]);
  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadSchedule = async () => {
    setIsLoading(true);
    setMessage(null);

    try {
      const result = await getJson<PlatformThemeScheduleResponse>('/api/admin/theme/schedule');
      setEntries(
        result.entries.map((entry) => ({
          effectiveAt: formatUtc8DateTimeInput(new Date(entry.effectiveAt)),
          tone: entry.tone,
          enabled: entry.enabled,
          note: entry.note ?? '',
        })),
      );
      cachePlatformThemeConfig(normalizePlatformThemeConfig(result));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '读取主题计划失败。');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadSchedule();
  }, []);

  const updateEntry = (index: number, patch: Partial<EditableThemeEntry>) => {
    setEntries((currentEntries) =>
      currentEntries.map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, ...patch } : entry,
      ),
    );
  };

  const addEntry = () => {
    setEntries((currentEntries) => [
      ...currentEntries,
      {
        effectiveAt: formatUtc8DateTimeInput(new Date(Date.now() + 60 * 60 * 1000)),
        tone: 'red',
        enabled: true,
        note: '',
      },
    ]);
  };

  const removeEntry = (index: number) => {
    setEntries((currentEntries) => currentEntries.filter((_, entryIndex) => entryIndex !== index));
  };

  const submitSchedule = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setMessage(null);

    try {
      const result = await postJson<PlatformThemeScheduleResponse>('/api/admin/theme/schedule', {
        entries: entries.map((entry) => ({
          effectiveAt: utc8DateTimeInputToIso(entry.effectiveAt),
          tone: entry.tone,
          enabled: entry.enabled,
          note: entry.note.trim() || undefined,
        })),
      });
      setEntries(
        result.entries.map((entry) => ({
          effectiveAt: formatUtc8DateTimeInput(new Date(entry.effectiveAt)),
          tone: entry.tone,
          enabled: entry.enabled,
          note: entry.note ?? '',
        })),
      );
      cachePlatformThemeConfig(normalizePlatformThemeConfig(result));
      setMessage('主题自动切换计划已保存。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存主题计划失败。');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section
      className={embedded ? 'theme-schedule-embedded' : 'admin-panel'}
      aria-labelledby="theme-schedule-title"
    >
      {!embedded ? (
        <div className="admin-panel-heading">
          <div>
            <p>平台管理</p>
            <h1 id="theme-schedule-title">主题计划</h1>
          </div>
        </div>
      ) : (
        <div className="detail-section-heading">
          <h2 id="theme-schedule-title">主题</h2>
          <span>{entries.length}</span>
        </div>
      )}

      {message ? (
        <div className="flow-notice" role="status" aria-live="polite">
          <span>{message}</span>
        </div>
      ) : null}

      {isLoading ? <p className="empty-note">正在读取主题计划。</p> : null}

      <form className="theme-schedule-form" onSubmit={submitSchedule}>
        <div className="theme-schedule-list">
          {entries.map((entry, index) => (
            <article className="theme-schedule-item" key={`${entry.effectiveAt}-${index}`}>
              <label>
                <span>生效时间 UTC+8</span>
                <input
                  type="datetime-local"
                  value={entry.effectiveAt}
                  onChange={(event) => updateEntry(index, { effectiveAt: event.target.value })}
                  required
                />
              </label>
              <label>
                <span>主题色</span>
                <select
                  value={entry.tone}
                  onChange={(event) =>
                    updateEntry(index, { tone: event.target.value as AccentTone })
                  }
                >
                  {toneOptions.map((tone) => (
                    <option value={tone.value} key={tone.value}>
                      {tone.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="inline-toggle">
                <input
                  type="checkbox"
                  checked={entry.enabled}
                  onChange={(event) => updateEntry(index, { enabled: event.target.checked })}
                />
                <span>启用</span>
              </label>
              <label>
                <span>备注</span>
                <input
                  value={entry.note}
                  onChange={(event) => updateEntry(index, { note: event.target.value })}
                  placeholder="例如活动主题"
                  maxLength={120}
                />
              </label>
              <button
                className="secondary-action"
                type="button"
                onClick={() => removeEntry(index)}
                disabled={entries.length <= 1}
              >
                删除
              </button>
            </article>
          ))}
        </div>

        <div className="form-actions">
          <button
            className="secondary-action"
            type="button"
            onClick={addEntry}
            disabled={entries.length >= 24}
          >
            添加时间段
          </button>
          <button className="primary-action" type="submit" disabled={isSubmitting}>
            <span className="material-symbols-rounded" aria-hidden="true">
              schedule
            </span>
            <span>{isSubmitting ? '保存中' : '保存计划'}</span>
          </button>
        </div>
      </form>
    </section>
  );
}

function utc8DateTimeInputToIso(value: string): string {
  const [datePart = '', timePart = ''] = value.split('T');
  const [year = '1970', month = '1', day = '1'] = datePart.split('-');
  const [hour = '0', minute = '0'] = timePart.split(':');
  const timestamp = Date.UTC(
    Number.parseInt(year, 10),
    Number.parseInt(month, 10) - 1,
    Number.parseInt(day, 10),
    Number.parseInt(hour, 10) - 8,
    Number.parseInt(minute, 10),
  );

  return new Date(timestamp).toISOString();
}

function formatUtc8DateTimeInput(date: Date): string {
  const utc8Date = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const year = utc8Date.getUTCFullYear();
  const month = utc8Date.getUTCMonth() + 1;
  const day = utc8Date.getUTCDate();
  const hour = utc8Date.getUTCHours();
  const minute = utc8Date.getUTCMinutes();

  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}
