'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { getJson, postJson } from '../../api-client';

interface CardTemplateVariant {
  id: string;
  key: string;
  name: string;
  category: 'account' | 'identity_key' | 'ticket';
  enabled: boolean;
  config: unknown;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
}

interface CardTemplateVariantsResponse {
  variants: CardTemplateVariant[];
}

interface CardTemplateVariantResponse {
  variant: CardTemplateVariant;
}

const categoryOptions: Array<{ value: CardTemplateVariant['category']; label: string }> = [
  { value: 'account', label: '账户/卡' },
  { value: 'identity_key', label: '证件/钥匙' },
  { value: 'ticket', label: '票券' },
];

export function AdminCardTemplateVariantsPanel() {
  const [variants, setVariants] = useState<CardTemplateVariant[]>([]);
  const [keyword, setKeyword] = useState('');
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [detailVariant, setDetailVariant] = useState<CardTemplateVariant | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editingVariantId, setEditingVariantId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const filteredVariants = useMemo(() => {
    const keywordText = keyword.trim().toLowerCase();
    if (!keywordText) {
      return variants;
    }

    return variants.filter((variant) =>
      [variant.key, variant.name, variant.category, variant.enabled ? '启用' : '停用']
        .join(' ')
        .toLowerCase()
        .includes(keywordText),
    );
  }, [keyword, variants]);

  const loadVariants = async () => {
    setIsLoading(true);
    setMessage(null);

    try {
      const result = await getJson<CardTemplateVariantsResponse>('/api/admin/card-template-variants');
      setVariants(result.variants);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '读取卡面模板变体失败。');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadVariants();
  }, []);

  const createVariant = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setIsSubmitting(true);
    setMessage(null);

    try {
      const result = await postJson<CardTemplateVariantResponse>('/api/admin/card-template-variants', {
        key: String(form.get('key') ?? '').trim(),
        name: String(form.get('name') ?? '').trim(),
        category: String(form.get('category') ?? ''),
        enabled: form.get('enabled') === 'on',
        config: parseConfigJson(String(form.get('config') ?? '')),
      });
      setVariants((currentVariants) => [result.variant, ...currentVariants]);
      setMessage('卡面模板变体已创建。');
      formElement.reset();
      setIsCreateDialogOpen(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '创建卡面模板变体失败。');
    } finally {
      setIsSubmitting(false);
    }
  };

  const exportVariantsCsv = () => {
    const rows = filteredVariants.map((variant) => ({
      id: variant.id,
      key: variant.key,
      name: variant.name,
      category: formatCategory(variant.category),
      enabled: variant.enabled ? '启用' : '停用',
      updatedAt: variant.updatedAt,
    }));
    downloadTextFile('ldpass-admin-card-template-variants.csv', toCsv(rows), 'text/csv;charset=utf-8');
    setMessage('模板变体 CSV 已生成。');
  };

  const updateVariant = async (event: FormEvent<HTMLFormElement>, variant: CardTemplateVariant) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setIsSubmitting(true);
    setMessage(null);

    try {
      const result = await postJson<CardTemplateVariantResponse>(`/api/admin/card-template-variants/${variant.id}`, {
        name: String(form.get('name') ?? '').trim(),
        category: String(form.get('category') ?? ''),
        enabled: form.get('enabled') === 'on',
        config: parseConfigJson(String(form.get('config') ?? '')),
      });
      setVariants((currentVariants) => currentVariants.map((item) => (item.id === result.variant.id ? result.variant : item)));
      setEditingVariantId(null);
      setMessage('卡面模板变体已保存。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存卡面模板变体失败。');
    } finally {
      setIsSubmitting(false);
    }
  };

  const deleteVariant = async (variant: CardTemplateVariant) => {
    if (!window.confirm(`删除卡面模板变体「${variant.name}」吗？已经引用该 key 的历史模板不会被自动改写。`)) {
      return;
    }

    setIsSubmitting(true);
    setMessage(null);

    try {
      await postJson(`/api/admin/card-template-variants/${variant.id}/delete`);
      setVariants((currentVariants) => currentVariants.filter((item) => item.id !== variant.id));
      setEditingVariantId(null);
      setMessage('卡面模板变体已删除。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '删除卡面模板变体失败。');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="admin-panel" aria-labelledby="card-template-variants-title">
      <div className="admin-panel-heading">
        <div>
          <p>平台管理</p>
          <h1 id="card-template-variants-title">卡面模板变体</h1>
        </div>
        <div className="admin-list-actions">
          <button className="primary-action" type="button" onClick={() => setIsCreateDialogOpen(true)}>
            <span className="material-symbols-rounded" aria-hidden="true">
              add
            </span>
            <span>新增模板</span>
          </button>
          <button className="secondary-action" type="button" onClick={() => void loadVariants()}>
            <span className="material-symbols-rounded" aria-hidden="true">
              refresh
            </span>
            <span>刷新</span>
          </button>
          <button className="secondary-action" type="button" onClick={exportVariantsCsv}>
            <span className="material-symbols-rounded" aria-hidden="true">
              file_save
            </span>
            <span>导出 CSV</span>
          </button>
          <a className="secondary-action" href="/admin/pass-templates">
            模板审核
          </a>
        </div>
      </div>

      {message ? (
        <div className="flow-notice" role="status" aria-live="polite">
          <span>{message}</span>
        </div>
      ) : null}

      <form className="audit-filter-grid" onSubmit={(event) => event.preventDefault()}>
        <label>
          <span>搜索模板变体</span>
          <input
            type="search"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="标识、名称、分类、状态"
          />
        </label>
        <div className="audit-filter-actions">
          <button className="secondary-action" type="button" onClick={() => void loadVariants()}>
            刷新
          </button>
          <button className="secondary-action" type="button" onClick={() => setKeyword('')}>
            重置
          </button>
        </div>
      </form>

      {isLoading ? <p className="empty-note">正在读取卡面模板变体。</p> : null}
      {!isLoading && filteredVariants.length === 0 ? <p className="empty-note">还没有匹配的卡面模板变体。</p> : null}

      <div className="admin-list">
        {filteredVariants.map((variant) => (
          <article className="admin-list-item admin-list-item-review" key={variant.id}>
            {editingVariantId === variant.id ? (
              <form className="stacked-form" onSubmit={(event) => void updateVariant(event, variant)}>
                <div>
                  <h2>{variant.key}</h2>
                  <p>标识创建后不可修改，避免历史卡券模板引用失效。</p>
                </div>
                <div className="admin-adjustment-panel card-template-variant-form">
                  <label>
                    <span>名称</span>
                    <input name="name" defaultValue={variant.name} required minLength={2} maxLength={80} />
                  </label>
                  <label>
                    <span>分类</span>
                    <select name="category" defaultValue={variant.category} required>
                      {categoryOptions.map((category) => (
                        <option value={category.value} key={category.value}>
                          {category.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="inline-toggle">
                    <input type="checkbox" name="enabled" defaultChecked={variant.enabled} />
                    <span>启用</span>
                  </label>
                </div>
                <label>
                  <span>配置 JSON</span>
                  <textarea name="config" defaultValue={toPrettyJson(variant.config)} rows={4} />
                </label>
                <div className="admin-list-actions">
                  <button className="secondary-action" type="button" onClick={() => setEditingVariantId(null)}>
                    取消
                  </button>
                  <button className="danger-action" type="button" onClick={() => void deleteVariant(variant)} disabled={isSubmitting}>
                    删除
                  </button>
                  <button className="primary-action" type="submit" disabled={isSubmitting}>
                    保存
                  </button>
                </div>
              </form>
            ) : (
              <>
                <div>
                  <h2>{variant.name}</h2>
                  <p className="admin-meta-line">
                    <span>{variant.key}</span>
                    <CategoryTag category={variant.category} />
                    <span>{variant.enabled ? '启用' : '停用'}</span>
                  </p>
                  <p>最近更新：{new Date(variant.updatedAt).toLocaleString('zh-CN')}</p>
                </div>
                <div className="admin-list-actions">
                  <button className="secondary-action" type="button" onClick={() => setDetailVariant(variant)}>
                    详情
                  </button>
                  <button className="secondary-action" type="button" onClick={() => setEditingVariantId(variant.id)}>
                    编辑
                  </button>
                </div>
              </>
            )}
          </article>
        ))}
      </div>
      {isCreateDialogOpen ? (
        <div className="admin-dialog-layer">
          <button className="admin-dialog-scrim" type="button" aria-label="关闭弹窗" onClick={() => setIsCreateDialogOpen(false)} />
          <section className="admin-dialog-panel" role="dialog" aria-modal="true" aria-label="新增模板变体">
            <div className="admin-dialog-heading">
              <h2>新增模板</h2>
              <button className="icon-button" type="button" aria-label="关闭弹窗" onClick={() => setIsCreateDialogOpen(false)}>
                <span className="material-symbols-rounded" aria-hidden="true">
                  close
                </span>
              </button>
            </div>
            <form className="admin-dialog-form" onSubmit={createVariant}>
              <label>
                <span>标识</span>
                <input name="key" placeholder="standard" pattern="[a-z0-9][a-z0-9_-]*" required minLength={2} maxLength={48} />
              </label>
              <label>
                <span>名称</span>
                <input name="name" placeholder="标准横版" required minLength={2} maxLength={80} />
              </label>
              <label>
                <span>分类</span>
                <select name="category" defaultValue="account" required>
                  {categoryOptions.map((category) => (
                    <option value={category.value} key={category.value}>
                      {category.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="inline-toggle">
                <input type="checkbox" name="enabled" defaultChecked />
                <span>启用</span>
              </label>
              <label>
                <span>配置 JSON</span>
                <textarea name="config" defaultValue="{}" rows={6} />
              </label>
              <div className="admin-dialog-actions">
                <button className="secondary-action" type="button" onClick={() => setIsCreateDialogOpen(false)}>
                  取消
                </button>
                <button className="primary-action" type="submit" disabled={isSubmitting}>
                  {isSubmitting ? '创建中' : '创建'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
      {detailVariant ? (
        <div className="admin-dialog-layer">
          <button className="admin-dialog-scrim" type="button" aria-label="关闭弹窗" onClick={() => setDetailVariant(null)} />
          <section className="admin-dialog-panel" role="dialog" aria-modal="true" aria-label="模板变体详情">
            <div className="admin-dialog-heading">
              <h2>{detailVariant.name}</h2>
              <button className="icon-button" type="button" aria-label="关闭弹窗" onClick={() => setDetailVariant(null)}>
                <span className="material-symbols-rounded" aria-hidden="true">
                  close
                </span>
              </button>
            </div>
            <dl className="admin-detail-list">
              <div>
                <dt>标识</dt>
                <dd>{detailVariant.key}</dd>
              </div>
              <div>
                <dt>分类</dt>
                <dd>{formatCategory(detailVariant.category)}</dd>
              </div>
              <div>
                <dt>状态</dt>
                <dd>{detailVariant.enabled ? '启用' : '停用'}</dd>
              </div>
              <div>
                <dt>更新时间</dt>
                <dd>{new Date(detailVariant.updatedAt).toLocaleString('zh-CN')}</dd>
              </div>
            </dl>
            <pre className="audit-summary">{toPrettyJson(detailVariant.config)}</pre>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function parseConfigJson(value: string): unknown {
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return {};
  }

  return JSON.parse(trimmedValue) as unknown;
}

function toPrettyJson(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2);
}

function formatCategory(category: CardTemplateVariant['category']): string {
  return categoryOptions.find((item) => item.value === category)?.label ?? category;
}

function CategoryTag({ category }: { category: CardTemplateVariant['category'] }) {
  return (
    <span className={`admin-category-tag admin-category-tag-${category}`}>
      {formatCategory(category)}
    </span>
  );
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
