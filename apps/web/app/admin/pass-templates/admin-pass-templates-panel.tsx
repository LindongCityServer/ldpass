'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
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

interface TemplateGroup {
  templateId: string;
  displayName: string;
  category: string;
  benefitType: string;
  templateStatus: string;
  provider: PendingTemplate['provider'];
  versions: PendingTemplate[];
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
  const [keyword, setKeyword] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [activeTemplate, setActiveTemplate] = useState<PendingTemplate | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const allTemplates = useMemo(() => [...templates, ...approvedTemplates], [templates, approvedTemplates]);
  const templateGroups = useMemo(() => groupTemplates(allTemplates), [allTemplates]);
  const filteredTemplateGroups = useMemo(
    () =>
      templateGroups.filter((group) => {
        const keywordText = keyword.trim().toLowerCase();
        const matchesKeyword =
          !keywordText ||
          [
            group.displayName,
            group.provider.name,
            group.provider.slug,
            group.category,
            group.benefitType,
            group.templateStatus,
            ...group.versions.flatMap((template) => [template.title, template.status, String(template.version)]),
          ]
            .join(' ')
            .toLowerCase()
            .includes(keywordText);
        const matchesCategory = categoryFilter === 'all' || group.category === categoryFilter;
        return matchesKeyword && matchesCategory;
      }),
    [categoryFilter, keyword, templateGroups],
  );
  const filteredTemplates = useMemo(
    () => filteredTemplateGroups.flatMap((group) => group.versions),
    [filteredTemplateGroups],
  );

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
      setMessage('已打回卡券模板。');
      await loadTemplates();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '打回模板失败。');
    }
  };

  const submitFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
  };

  const exportTemplatesCsv = () => {
    const rows = filteredTemplates.map((template) => ({
      versionId: template.versionId,
      name: template.template.displayName,
      provider: template.provider.name,
      providerSlug: template.provider.slug,
      category: categoryLabels[template.template.category] ?? template.template.category,
      benefitType: benefitLabels[template.template.benefitType] ?? template.template.benefitType,
      status: formatTemplateStatus(template.status),
      version: String(template.version),
      createdAt: template.createdAt,
    }));

    downloadTextFile('ldpass-admin-pass-templates.csv', toCsv(rows), 'text/csv;charset=utf-8');
    setMessage('卡面模板 CSV 已生成。');
  };

  return (
    <section className="admin-panel" aria-labelledby="admin-pass-templates-title">
      <div className="admin-panel-heading">
        <div>
          <p>平台管理</p>
          <h1 id="admin-pass-templates-title">卡面模板</h1>
        </div>
        <div className="admin-list-actions">
          <button className="secondary-action" type="button" onClick={() => void loadTemplates()}>
            <span className="material-symbols-rounded" aria-hidden="true">
              refresh
            </span>
            <span>刷新</span>
          </button>
          <button className="secondary-action" type="button" onClick={exportTemplatesCsv}>
            <span className="material-symbols-rounded" aria-hidden="true">
              file_save
            </span>
            <span>导出 CSV</span>
          </button>
          <a className="secondary-action" href="/admin/providers">
            发卡方
          </a>
          <a className="secondary-action" href="/admin/card-template-variants">
            模板变体
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

      <form className="audit-filter-grid" onSubmit={submitFilters}>
        <label>
          <span>搜索模板</span>
          <input
            type="search"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="名称、发卡方、标识、状态"
          />
        </label>
        <label>
          <span>分类</span>
          <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
            <option value="all">全部分类</option>
            {Object.entries(categoryLabels).map(([value, label]) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <div className="audit-filter-actions">
          <button className="secondary-action" type="button" onClick={() => void loadTemplates()}>
            刷新
          </button>
          <button
            className="secondary-action"
            type="button"
            onClick={() => {
              setKeyword('');
              setCategoryFilter('all');
            }}
          >
            重置
          </button>
        </div>
      </form>

      {isLoading ? <p className="empty-note">正在读取模板列表。</p> : null}
      {!isLoading && filteredTemplateGroups.length === 0 ? <p className="empty-note">暂无匹配模板。</p> : null}

      <div className="admin-list">
        {filteredTemplateGroups.map((group) => {
          const previewTemplate = group.versions[0];

          return (
          <article className="admin-list-item admin-list-item-review" key={group.templateId}>
            <div>
              <h2>{group.displayName}</h2>
              <p className="admin-meta-line">
                <span>{group.provider.name}（{group.provider.slug}）</span>
                <CategoryTag category={group.category} />
                <span>{benefitLabels[group.benefitType] ?? group.benefitType}</span>
                <span>{group.versions.length} 个版本</span>
              </p>
              {previewTemplate ? <TemplateReviewPreview template={previewTemplate} /> : null}
              <div className="template-version-list" aria-label={`${group.displayName} 的版本`}>
                {group.versions.map((template) => (
                  <div className="template-version-row" key={template.versionId}>
                    <div>
                      <strong>v{template.version}</strong>
                      <span>{template.title}</span>
                      <small>{formatTemplateStatus(template.status)} · {formatDate(template.createdAt)}</small>
                    </div>
                    <div className="admin-list-actions">
                      <button className="secondary-action" type="button" onClick={() => setActiveTemplate(template)}>
                        详情
                      </button>
                      <button className="secondary-action" type="button" onClick={() => void rejectTemplate(template.versionId)}>
                        {template.status === 'Approved' ? '打回' : '驳回'}
                      </button>
                      {template.status === 'PendingReview' ? (
                        <button className="primary-action" type="button" onClick={() => void approveTemplate(template.versionId)}>
                          <span className="material-symbols-rounded" aria-hidden="true">
                            check
                          </span>
                          <span>批准</span>
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </article>
          );
        })}
      </div>

      {activeTemplate ? <TemplateDetailDialog template={activeTemplate} onClose={() => setActiveTemplate(null)} /> : null}
    </section>
  );
}

function TemplateDetailDialog({ template, onClose }: { template: PendingTemplate; onClose: () => void }) {
  return (
    <div className="admin-dialog-layer">
      <button className="admin-dialog-scrim" type="button" aria-label="关闭弹窗" onClick={onClose} />
      <section className="admin-dialog-panel" role="dialog" aria-modal="true" aria-label="卡面模板详情">
        <div className="admin-dialog-heading">
          <h2>{template.template.displayName}</h2>
          <button className="icon-button" type="button" aria-label="关闭弹窗" onClick={onClose}>
            <span className="material-symbols-rounded" aria-hidden="true">
              close
            </span>
          </button>
        </div>
        <TemplateReviewPreview template={template} />
        <dl className="admin-detail-list">
          <div>
            <dt>发卡方</dt>
            <dd>
              {template.provider.name}（{template.provider.slug}）
            </dd>
          </div>
          <div>
            <dt>分类</dt>
            <dd>
              <CategoryTag category={template.template.category} />
            </dd>
          </div>
          <div>
            <dt>状态</dt>
            <dd>{formatTemplateStatus(template.status)}</dd>
          </div>
          <div>
            <dt>版本</dt>
            <dd>v{template.version}</dd>
          </div>
          <div>
            <dt>标题</dt>
            <dd>{template.title}</dd>
          </div>
          <div>
            <dt>背景图</dt>
            <dd>{template.backgroundImageUrl ?? '未设置'}</dd>
          </div>
          <div>
            <dt>Logo</dt>
            <dd>{template.logoUrl ?? '未设置'}</dd>
          </div>
          {template.description ? (
            <div>
              <dt>说明</dt>
              <dd>{template.description}</dd>
            </div>
          ) : null}
        </dl>
        <TemplateSemanticSummary template={template} />
      </section>
    </div>
  );
}

function CategoryTag({ category }: { category: string }) {
  return (
    <span className={`admin-category-tag admin-category-tag-${category}`}>
      {categoryLabels[category] ?? category}
    </span>
  );
}

function groupTemplates(templates: PendingTemplate[]): TemplateGroup[] {
  const groups = new Map<string, TemplateGroup>();

  for (const template of templates) {
    const existingGroup = groups.get(template.template.id);
    if (existingGroup) {
      existingGroup.versions.push(template);
      continue;
    }

    groups.set(template.template.id, {
      templateId: template.template.id,
      displayName: template.template.displayName,
      category: template.template.category,
      benefitType: template.template.benefitType,
      templateStatus: template.template.status,
      provider: template.provider,
      versions: [template],
    });
  }

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      versions: group.versions.sort((first, second) => second.version - first.version),
    }))
    .sort((first, second) => first.displayName.localeCompare(second.displayName, 'zh-CN'));
}

function TemplateSemanticSummary({ template }: { template: PendingTemplate }) {
  return (
    <div className="template-semantic-summary" aria-label="模板规则摘要">
      <p className="audit-summary">规则：{summarizeTemplateRules(template.rules).join('；')}</p>
      <p className="audit-summary">位置规则：{summarizeLocationRules(template.locationRules).join('；')}</p>
      <p className="audit-summary">样式：{summarizeCardStyle(template.cardStyle).join('；')}</p>
    </div>
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

function summarizeTemplateRules(value: unknown): string[] {
  const rules = asRecord(value);
  if (!rules) {
    return ['未配置模板规则'];
  }

  const redemptionProviderCount = readStringArray(rules.allowedRedemptionProviderIds).length;
  const reminderDays = readNumber(rules.expirationReminderDefaultDays);
  return [
    readBoolean(rules.transferable, false) ? '允许转赠' : '不允许转赠',
    readBoolean(rules.shareable, true) ? '允许分享' : '不允许分享',
    readBoolean(rules.allowOverdraft, false) ? '允许透支' : '不允许透支',
    readBoolean(rules.allowFrozenBalance, true) ? '支持冻结余额' : '不支持冻结余额',
    readBoolean(rules.allowTopUpIn, false) ? '可被额度补充' : '不可被额度补充',
    readBoolean(rules.allowTopUpOut, false) ? '可作为补充来源' : '不可作为补充来源',
    readBoolean(rules.requireServerVerifiedUser, false) ? '领取需服务器账号验证' : '领取不要求服务器账号验证',
    readBoolean(rules.requireLocationVerification, false) ? '核验需要位置校验' : '核验不需要位置校验',
    redemptionProviderCount > 0 ? `限定 ${redemptionProviderCount} 个核销提供方` : '不限制核销提供方',
    Number.isFinite(reminderDays) ? `默认提前 ${reminderDays} 天提醒过期` : '使用系统默认过期提醒',
  ];
}

function summarizeLocationRules(value: unknown): string[] {
  const container = asRecord(value);
  const rawRules = Array.isArray(value) ? value : container && Array.isArray(container.rules) ? container.rules : [];

  if (rawRules.length === 0) {
    return ['未启用位置规则'];
  }

  return rawRules.map((rule, index) => summarizeLocationRule(rule, index));
}

function summarizeLocationRule(value: unknown, index: number): string {
  const rule = asRecord(value);
  if (!rule) {
    return `位置范围 ${index + 1} 配置异常`;
  }

  const label = readString(rule.label) || `位置范围 ${index + 1}`;
  const expiresAfterSeconds = readNumber(rule.expiresAfterSeconds);
  const ttl = Number.isFinite(expiresAfterSeconds) ? `，位置有效 ${expiresAfterSeconds} 秒` : '';

  if (rule.kind === 'circle') {
    return `${label}：圆形范围，中心 X ${formatRuleNumber(rule.centerX)} / Z ${formatRuleNumber(rule.centerZ)}，半径 ${formatRuleNumber(rule.radius)}${ttl}`;
  }

  if (rule.kind === 'rectangle') {
    return `${label}：矩形范围，X ${formatRuleNumber(rule.minX)} 到 ${formatRuleNumber(rule.maxX)}，Z ${formatRuleNumber(rule.minZ)} 到 ${formatRuleNumber(rule.maxZ)}${ttl}`;
  }

  return `${label}：未知位置范围类型`;
}

function summarizeCardStyle(value: unknown): string[] {
  const cardStyle = asRecord(value);
  if (!cardStyle) {
    return ['使用默认卡面样式'];
  }

  const variantKey = readString(cardStyle.variantKey) || 'standard';
  const cardColor = readString(cardStyle.cardColor);
  return [`卡面变体：${variantKey}`, cardColor ? `主色：${cardColor}` : '主色：默认'];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function readNumber(value: unknown): number {
  return typeof value === 'number' ? value : Number.NaN;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function formatRuleNumber(value: unknown): string {
  const numberValue = readNumber(value);
  return Number.isFinite(numberValue) ? String(numberValue) : '未设置';
}

function formatTemplateStatus(status: string): string {
  const labels: Record<string, string> = {
    PendingReview: '审核中',
    Approved: '已过审',
    Rejected: '已驳回',
  };

  return labels[status] ?? status;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString('zh-CN', {
    hour12: false,
  });
}

function toCsv(rows: Array<Record<string, string>>): string {
  if (rows.length === 0) {
    return '';
  }

  const headers = Object.keys(rows[0] ?? {});
  return [headers.join(','), ...rows.map((row) => headers.map((header) => escapeCsvCell(row[header] ?? '')).join(','))].join('\r\n');
}

function escapeCsvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function downloadTextFile(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
