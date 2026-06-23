'use client';

import { useEffect, useState } from 'react';
import { getJson, postJson } from '../../api-client';

interface PendingTemplate {
  versionId: string;
  version: number;
  status: string;
  title: string;
  description: string | null;
  cardStyle: unknown;
  fields: unknown;
  rules: unknown;
  locationRules: unknown;
  backgroundImageUrl: string | null;
  logoUrl: string | null;
  createdAt: string;
  template: {
    id: string;
    displayName: string;
    category: string;
    benefitType: string;
    status: string;
  };
  provider: {
    id: string;
    name: string;
    slug: string;
  };
}

interface PendingTemplatesResponse {
  templates: PendingTemplate[];
}

const categoryLabels: Record<string, string> = {
  account: '账户/卡',
  identity_key: '证件/钥匙',
  ticket: '票券',
};

const benefitLabels: Record<string, string> = {
  amount: '金额',
  points: '积分',
  times: '次数',
};

export function AdminPassTemplatesPanel() {
  const [templates, setTemplates] = useState<PendingTemplate[]>([]);
  const [approvedTemplates, setApprovedTemplates] = useState<PendingTemplate[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadTemplates = async () => {
    setIsLoading(true);
    setMessage(null);

    try {
      const [pendingResult, approvedResult] = await Promise.all([
        getJson<PendingTemplatesResponse>('/api/admin/pass-templates/pending'),
        getJson<PendingTemplatesResponse>('/api/admin/pass-templates/approved'),
      ]);
      setTemplates(pendingResult.templates);
      setApprovedTemplates(approvedResult.templates);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '读取模板审核列表失败。');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadTemplates();
  }, []);

  const approveTemplate = async (versionId: string) => {
    setMessage(null);

    try {
      await postJson(`/api/admin/pass-templates/${versionId}/approve`);
      setMessage('已通过卡券模板审核。');
      await loadTemplates();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '通过模板失败。');
    }
  };

  const rejectTemplate = async (versionId: string) => {
    const reason = window.prompt('请输入拒绝原因');
    if (!reason) {
      return;
    }

    setMessage(null);

    try {
      await postJson(`/api/admin/pass-templates/${versionId}/reject`, { reason });
      setMessage('已拒绝卡券模板。');
      await loadTemplates();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '拒绝模板失败。');
    }
  };

  return (
    <section className="admin-panel" aria-labelledby="admin-pass-templates-title">
      <div className="admin-panel-heading">
        <div>
          <p>平台管理</p>
          <h1 id="admin-pass-templates-title">模板审核</h1>
        </div>
        <div className="admin-list-actions">
          <button className="secondary-action" type="button" onClick={() => void loadTemplates()}>
            刷新
          </button>
          <a className="secondary-action" href="/admin/providers">
            提供方审核
          </a>
          <a className="secondary-action" href="/admin/card-template-variants">
            卡面变体
          </a>
          <a className="secondary-action" href="/admin/users">
            用户审核
          </a>
        </div>
      </div>

      {message ? (
        <div className="flow-notice" role="status" aria-live="polite">
          <span>{message}</span>
        </div>
      ) : null}

      {isLoading ? <p className="empty-note">正在读取模板列表。</p> : null}
      {!isLoading && templates.length === 0 ? <p className="empty-note">暂无需要审核的卡券模板。</p> : null}

      <div className="admin-list">
        {templates.map((template) => (
          <article className="admin-list-item admin-list-item-review" key={template.versionId}>
            <div>
              <h2>{template.template.displayName}</h2>
              <p>
                {template.provider.name}（{template.provider.slug}）· {categoryLabels[template.template.category] ?? template.template.category} ·{' '}
                {benefitLabels[template.template.benefitType] ?? template.template.benefitType}
              </p>
              <p>
                v{template.version} · {template.title} · 状态：{template.status}
              </p>
              <TemplateReviewPreview template={template} />
              {template.description ? <p>说明：{template.description}</p> : null}
              {template.backgroundImageUrl ? <p>背景图：{template.backgroundImageUrl}</p> : null}
              {template.logoUrl ? <p>Logo：{template.logoUrl}</p> : null}
              <p className="audit-summary">规则：{toCompactJson(template.rules)}</p>
              {template.locationRules ? <p className="audit-summary">位置规则：{toCompactJson(template.locationRules)}</p> : null}
              <p className="audit-summary">样式：{toCompactJson(template.cardStyle)}</p>
            </div>
            <div className="admin-list-actions">
              <button className="secondary-action" type="button" onClick={() => void rejectTemplate(template.versionId)}>
                拒绝
              </button>
              <button className="primary-action" type="button" onClick={() => void approveTemplate(template.versionId)}>
                <span className="material-symbols-rounded" aria-hidden="true">
                  check
                </span>
                <span>通过</span>
              </button>
            </div>
          </article>
        ))}
      </div>

      <div className="detail-section-heading">
        <h3>已过审模板</h3>
        <span>{approvedTemplates.length}</span>
      </div>
      {!isLoading && approvedTemplates.length === 0 ? <p className="empty-note">暂无已过审模板。</p> : null}
      <div className="admin-list">
        {approvedTemplates.map((template) => (
          <article className="admin-list-item admin-list-item-review" key={template.versionId}>
            <div>
              <h2>{template.template.displayName}</h2>
              <p>
                {template.provider.name}（{template.provider.slug}）· {categoryLabels[template.template.category] ?? template.template.category} ·{' '}
                {benefitLabels[template.template.benefitType] ?? template.template.benefitType}
              </p>
              <p>
                v{template.version} · {template.title} · 状态：{template.status}
              </p>
              <TemplateReviewPreview template={template} />
              {template.description ? <p>说明：{template.description}</p> : null}
              {template.backgroundImageUrl ? <p>背景图：{template.backgroundImageUrl}</p> : null}
              {template.logoUrl ? <p>Logo：{template.logoUrl}</p> : null}
              <p className="audit-summary">规则：{toCompactJson(template.rules)}</p>
              {template.locationRules ? <p className="audit-summary">位置规则：{toCompactJson(template.locationRules)}</p> : null}
              <p className="audit-summary">样式：{toCompactJson(template.cardStyle)}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function TemplateReviewPreview({ template }: { template: PendingTemplate }) {
  const fields = asRecord(template.fields);
  const cardStyle = asRecord(template.cardStyle);
  const displayName = readString(fields?.primary) || template.template.displayName;
  const hideTitle = fields?.hideTitle === true;
  const cardColor = readString(cardStyle?.cardColor);
  const style = {
    ...(cardColor ? { backgroundColor: cardColor } : {}),
    ...(template.backgroundImageUrl
      ? {
          backgroundImage: `linear-gradient(180deg, rgba(0, 0, 0, 0.08), rgba(0, 0, 0, 0.26)), url("${template.backgroundImageUrl}")`,
        }
      : {}),
  };

  return (
    <section className={`template-card-preview template-card-preview-${template.template.category}`} aria-label="卡面预览">
      <div className="template-preview-pass" style={style}>
        <small>**** 5678</small>
      </div>
      <div className="template-preview-info">
        <span>{template.provider.name}</span>
        <strong>{displayName}</strong>
        <small>{hideTitle ? '标题已隐藏' : template.title}</small>
      </div>
    </section>
  );
}

function toCompactJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '无法显示';
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
