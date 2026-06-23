'use client';

import { useEffect, useState, type FormEvent } from 'react';
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
  const [message, setMessage] = useState<string | null>(null);
  const [editingVariantId, setEditingVariantId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

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
    const form = new FormData(event.currentTarget);
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
      event.currentTarget.reset();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '创建卡面模板变体失败。');
    } finally {
      setIsSubmitting(false);
    }
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
          <button className="secondary-action" type="button" onClick={() => void loadVariants()}>
            刷新
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

      <form className="stacked-form" onSubmit={createVariant}>
        <div className="admin-adjustment-panel card-template-variant-form">
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
        </div>
        <label>
          <span>配置 JSON</span>
          <textarea name="config" defaultValue="{}" rows={4} />
        </label>
        <div className="form-actions">
          <button className="primary-action" type="submit" disabled={isSubmitting}>
            <span className="material-symbols-rounded" aria-hidden="true">
              dashboard_customize
            </span>
            <span>{isSubmitting ? '创建中' : '新增变体'}</span>
          </button>
        </div>
      </form>

      {isLoading ? <p className="empty-note">正在读取卡面模板变体。</p> : null}
      {!isLoading && variants.length === 0 ? <p className="empty-note">还没有卡面模板变体。</p> : null}

      <div className="admin-list">
        {variants.map((variant) => (
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
                  <p>
                    {variant.key} · {formatCategory(variant.category)} · {variant.enabled ? '启用' : '停用'}
                  </p>
                  <p className="audit-summary">配置：{JSON.stringify(variant.config)}</p>
                </div>
                <div className="admin-list-actions">
                  <button className="secondary-action" type="button" onClick={() => setEditingVariantId(variant.id)}>
                    编辑
                  </button>
                </div>
              </>
            )}
          </article>
        ))}
      </div>
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
