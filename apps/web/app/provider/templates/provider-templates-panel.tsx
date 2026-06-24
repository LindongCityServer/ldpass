'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { getJson, postJson } from '../../api-client';

interface ProviderTemplate {
  id: string;
  category: string;
  benefitType: string;
  displayName: string;
  activeVersionId: string | null;
  status: string;
  latestVersion: {
    id: string;
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
    reviewReason: string | null;
    createdAt: string;
    updatedAt: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

interface ProviderTemplatesResponse {
  templates: ProviderTemplate[];
}

interface CardTemplateVariant {
  id: string;
  key: string;
  name: string;
  category: 'account' | 'identity_key' | 'ticket';
  enabled: boolean;
}

interface CardTemplateVariantsResponse {
  variants: CardTemplateVariant[];
}

interface CreateTemplateResponse {
  template: ProviderTemplate;
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

const fallbackTemplateVariants: Record<'account' | 'identity_key' | 'ticket', Array<{ key: string; name: string }>> = {
  account: [
    { key: 'standard', name: '标准横版' },
    { key: 'compact', name: '紧凑信息' },
  ],
  identity_key: [
    { key: 'standard', name: '标准横版' },
    { key: 'compact', name: '紧凑信息' },
  ],
  ticket: [
    { key: 'ticket', name: '票券信息' },
    { key: 'standard', name: '标准横版' },
  ],
};

export function ProviderTemplatesPanel() {
  const [templates, setTemplates] = useState<ProviderTemplate[]>([]);
  const [templateVariants, setTemplateVariants] = useState<CardTemplateVariant[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [detailTemplate, setDetailTemplate] = useState<ProviderTemplate | null>(null);
  const [isSubmittingVersion, setIsSubmittingVersion] = useState(false);
  const [templateCategory, setTemplateCategory] = useState<'account' | 'identity_key' | 'ticket'>('account');
  const [newTemplateLocationRules, setNewTemplateLocationRules] = useState<LocationRuleDraft[]>(() => [
    createLocationRuleDraft('circle'),
  ]);
  const [templatePreview, setTemplatePreview] = useState<TemplatePreviewState>({
    category: 'account',
    displayName: '卡券展示名称',
    title: '卡面标题',
    hideTitle: false,
    cardColor: '',
    backgroundImageUrl: '',
    logoUrl: '',
  });

  const loadTemplates = async () => {
    setIsLoading(true);
    setMessage(null);

    try {
      const result = await getJson<ProviderTemplatesResponse>('/api/provider/pass-templates');
      setTemplates(result.templates);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '读取模板列表失败。');
    } finally {
      setIsLoading(false);
    }
  };

  const loadTemplateVariants = async () => {
    try {
      const result = await getJson<CardTemplateVariantsResponse>('/api/card-template-variants');
      setTemplateVariants(result.variants);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '读取卡面模板变体失败，将使用内置选项。');
    }
  };

  useEffect(() => {
    void loadTemplates();
    void loadTemplateVariants();
  }, []);

  const currentVariantOptions = templateVariants
    .filter((variant) => variant.enabled && variant.category === templateCategory)
    .map((variant) => ({
      key: variant.key,
      name: variant.name,
    }));
  const visibleVariantOptions = currentVariantOptions.length ? currentVariantOptions : fallbackTemplateVariants[templateCategory];
  const editingTemplate = templates.find((template) => template.id === editingTemplateId) ?? null;

  const updateTemplatePreview = (form: HTMLFormElement) => {
    const formData = new FormData(form);
    const category = String(formData.get('category') ?? 'account');

    setTemplatePreview({
      category: isTemplateCategory(category) ? category : 'account',
      displayName: String(formData.get('displayName') ?? '').trim() || '卡券展示名称',
      title: String(formData.get('title') ?? '').trim() || '卡面标题',
      hideTitle: formData.get('hideTitle') === 'on',
      cardColor: String(formData.get('cardColor') ?? '').trim(),
      backgroundImageUrl: String(formData.get('backgroundImageUrl') ?? '').trim(),
      logoUrl: String(formData.get('logoUrl') ?? '').trim(),
    });
  };

  const createTemplate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setIsSubmitting(true);
    setMessage(null);
    const backgroundImageUrl = String(form.get('backgroundImageUrl') ?? '').trim();
    const logoUrl = String(form.get('logoUrl') ?? '').trim();
    const category = String(form.get('category') ?? '');
    const requireLocationVerification = category === 'identity_key' && form.get('requireLocationVerification') === 'on';
    const locationRulesJson = String(form.get('locationRulesJson') ?? '').trim();
    const payload: Record<string, unknown> = {
      category,
      benefitType: String(form.get('benefitType') ?? ''),
      displayName: String(form.get('displayName') ?? ''),
      title: String(form.get('title') ?? ''),
      description: String(form.get('description') ?? ''),
      variantKey: String(form.get('variantKey') ?? ''),
      cardColor: String(form.get('cardColor') ?? ''),
      ...(backgroundImageUrl ? { backgroundImageUrl } : {}),
      ...(logoUrl ? { logoUrl } : {}),
      transferable: form.get('transferable') === 'on',
      shareable: form.get('shareable') === 'on',
      allowOverdraft: form.get('allowOverdraft') === 'on',
      allowFrozenBalance: form.get('allowFrozenBalance') === 'on',
      allowTopUpIn: form.get('allowTopUpIn') === 'on',
      allowTopUpOut: form.get('allowTopUpOut') === 'on',
      allowedRedemptionProviderIdentifiers: String(form.get('allowedRedemptionProviderIdentifiers') ?? ''),
      hideTitle: form.get('hideTitle') === 'on',
      requireServerVerifiedUser: form.get('requireServerVerifiedUser') === 'on',
      ...(category === 'identity_key' ? { requireLocationVerification } : {}),
    };

    if (requireLocationVerification) {
      if (locationRulesJson) {
        payload.locationRulesJson = locationRulesJson;
      }
    }

    try {
      const result = await postJson<CreateTemplateResponse>('/api/provider/pass-templates', payload);

      setTemplates((currentTemplates) => [result.template, ...currentTemplates]);
      setMessage('卡券模板已提交管理员审核。');
      setIsCreateDialogOpen(false);
      formElement.reset();
      setTemplateCategory('account');
      setNewTemplateLocationRules([createLocationRuleDraft('circle')]);
      setTemplatePreview({
        category: 'account',
        displayName: '卡券展示名称',
        title: '卡面标题',
        hideTitle: false,
        cardColor: '',
        backgroundImageUrl: '',
        logoUrl: '',
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '提交模板失败。');
    } finally {
      setIsSubmitting(false);
    }
  };

  const startTemplateEdit = (template: ProviderTemplate) => {
    setEditingTemplateId(template.id);
    setDetailTemplate(null);
  };

  const submitTemplateVersion = async (event: FormEvent<HTMLFormElement>, template: ProviderTemplate) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setIsSubmittingVersion(true);
    setMessage(null);
    const backgroundImageUrl = String(form.get('backgroundImageUrl') ?? '').trim();
    const logoUrl = String(form.get('logoUrl') ?? '').trim();
    const category = template.category;
    const requireLocationVerification = category === 'identity_key' && form.get('requireLocationVerification') === 'on';
    const locationRulesJson = String(form.get('locationRulesJson') ?? '').trim();
    const payload: Record<string, unknown> = {
      category,
      benefitType: template.benefitType,
      displayName: String(form.get('displayName') ?? ''),
      title: String(form.get('title') ?? ''),
      description: String(form.get('description') ?? ''),
      variantKey: String(form.get('variantKey') ?? ''),
      cardColor: String(form.get('cardColor') ?? ''),
      ...(backgroundImageUrl ? { backgroundImageUrl } : {}),
      ...(logoUrl ? { logoUrl } : {}),
      transferable: form.get('transferable') === 'on',
      shareable: form.get('shareable') === 'on',
      allowOverdraft: form.get('allowOverdraft') === 'on',
      allowFrozenBalance: form.get('allowFrozenBalance') === 'on',
      allowTopUpIn: form.get('allowTopUpIn') === 'on',
      allowTopUpOut: form.get('allowTopUpOut') === 'on',
      allowedRedemptionProviderIdentifiers: String(form.get('allowedRedemptionProviderIdentifiers') ?? ''),
      hideTitle: form.get('hideTitle') === 'on',
      requireServerVerifiedUser: form.get('requireServerVerifiedUser') === 'on',
      ...(category === 'identity_key' ? { requireLocationVerification } : {}),
    };

    if (requireLocationVerification) {
      if (locationRulesJson) {
        payload.locationRulesJson = locationRulesJson;
      }
    }

    try {
      const result = await postJson<CreateTemplateResponse>(`/api/provider/pass-templates/${template.id}/versions`, payload);
      setTemplates((currentTemplates) =>
        currentTemplates.map((currentTemplate) => (currentTemplate.id === result.template.id ? result.template : currentTemplate)),
      );
      setEditingTemplateId(null);
      setMessage('新版本已提交管理员审核，审核通过前不会影响当前可发放版本。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '提交模板新版本失败。');
    } finally {
      setIsSubmittingVersion(false);
    }
  };

  return (
    <section className="admin-panel" aria-labelledby="provider-templates-title">
      <div className="admin-panel-heading">
        <div>
          <p>发卡方后台</p>
          <h1 id="provider-templates-title">卡券模板</h1>
        </div>
        <div className="admin-list-actions">
          <button className="primary-action" type="button" onClick={() => setIsCreateDialogOpen(true)}>
            <span className="material-symbols-rounded" aria-hidden="true">
              add
            </span>
            <span>新建模板</span>
          </button>
          <button className="secondary-action" type="button" onClick={() => void loadTemplates()}>
            刷新
          </button>
          <a className="secondary-action" href="/provider/dashboard">
            工作台
          </a>
        </div>
      </div>

      {message ? (
        <div className="flow-notice" role="status" aria-live="polite">
          <span>{message}</span>
        </div>
      ) : null}

      {isCreateDialogOpen ? (
        <div className="admin-dialog-layer">
          <button className="admin-dialog-scrim" type="button" aria-label="关闭弹窗" onClick={() => setIsCreateDialogOpen(false)} />
          <section className="admin-dialog-panel" role="dialog" aria-modal="true" aria-label="新建模板">
            <div className="admin-dialog-heading">
              <h2>新建模板</h2>
              <button className="icon-button" type="button" aria-label="关闭弹窗" onClick={() => setIsCreateDialogOpen(false)}>
                <span className="material-symbols-rounded" aria-hidden="true">
                  close
                </span>
              </button>
            </div>
      <form className="admin-dialog-form" onSubmit={createTemplate} onInput={(event) => updateTemplatePreview(event.currentTarget)} noValidate>
        <div className="admin-adjustment-panel provider-template-form">
          <label>
            <span>分类</span>
            <select
              name="category"
              value={templateCategory}
              onChange={(event) => setTemplateCategory(event.target.value as 'account' | 'identity_key' | 'ticket')}
              required
            >
              <option value="account">账户/卡</option>
              <option value="identity_key">证件/钥匙</option>
              <option value="ticket">票券</option>
            </select>
          </label>
          <label>
            <span>权益类型</span>
            <select name="benefitType" defaultValue="amount" required>
              <option value="amount">金额</option>
              <option value="points">积分</option>
              <option value="times">次数</option>
            </select>
          </label>
          <label>
            <span>展示名称</span>
            <input name="displayName" placeholder="例如：南部湾银行卡" required minLength={2} maxLength={80} />
          </label>
          <label>
            <span>卡面标题</span>
            <input name="title" placeholder="例如：临东大学校园卡" required minLength={2} maxLength={80} />
          </label>
          <label>
            <span>模板变体</span>
            <select name="variantKey" defaultValue={visibleVariantOptions[0]?.key ?? 'standard'} key={templateCategory}>
              {visibleVariantOptions.map((variant) => (
                <option value={variant.key} key={variant.key}>
                  {variant.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>卡面颜色</span>
            <input type="text" name="cardColor" placeholder="#28a67b" maxLength={32} />
          </label>
        </div>

        <TemplateCardPreview preview={templatePreview} />

        <label>
          <span>说明</span>
          <textarea name="description" maxLength={1000} />
        </label>
        <label>
          <span>背景图链接</span>
          <input type="url" name="backgroundImageUrl" placeholder="https://..." maxLength={1000} />
        </label>
        <label>
          <span>Logo 链接</span>
          <input type="url" name="logoUrl" placeholder="https://..." maxLength={1000} />
        </label>

        <div className="template-rule-grid">
          <label className="checkbox-row">
            <input type="checkbox" name="shareable" defaultChecked />
            <span>允许通过链接分享领取入口</span>
          </label>
          <label className="checkbox-row">
            <input type="checkbox" name="transferable" />
            <span>允许转赠</span>
          </label>
          <label className="checkbox-row">
            <input type="checkbox" name="allowFrozenBalance" defaultChecked />
            <span>允许冻结余额/权益</span>
          </label>
          <label className="checkbox-row">
            <input type="checkbox" name="allowTopUpIn" />
            <span>允许被其他卡补充额度</span>
          </label>
          <label className="checkbox-row">
            <input type="checkbox" name="allowTopUpOut" />
            <span>允许作为额度补充来源</span>
          </label>
          <label className="checkbox-row">
            <input type="checkbox" name="hideTitle" />
            <span>隐藏卡面标题</span>
          </label>
          <label className="checkbox-row">
            <input type="checkbox" name="allowOverdraft" />
            <span>允许透支显示</span>
          </label>
          <label className="checkbox-row">
            <input type="checkbox" name="requireServerVerifiedUser" />
            <span>领取时要求服务器账号已验证</span>
          </label>
        </div>

        <label>
          <span>允许核销方名单</span>
          <textarea
            name="allowedRedemptionProviderIdentifiers"
            maxLength={2000}
            placeholder="留空时仅允许本发卡方核销；如需授权其他发卡方，可填写对方标识或 ID，多个用逗号或换行分隔。"
          />
        </label>

        {templateCategory === 'identity_key' ? (
          <section className="stacked-form-subsection" aria-label="位置核验规则">
            <div className="detail-section-heading">
              <h2>位置核验</h2>
              <span>1分钟</span>
            </div>
            <div className="template-rule-grid">
              <label className="checkbox-row">
                <input type="checkbox" name="requireLocationVerification" />
                <span>启用玩家位置范围核验</span>
              </label>
            </div>
            <LocationRulesEditor
              rules={newTemplateLocationRules}
              onChange={setNewTemplateLocationRules}
              summary="最多 10 个范围，用户命中任意一个范围即通过。"
            />
          </section>
        ) : null}

        <div className="form-actions">
          <button className="primary-action" type="submit" disabled={isSubmitting}>
            <span className="material-symbols-rounded" aria-hidden="true">
              approval
            </span>
            <span>{isSubmitting ? '提交中' : '提交审核'}</span>
          </button>
        </div>
      </form>
          </section>
        </div>
      ) : null}

      {isLoading ? <p className="empty-note">正在读取模板列表。</p> : null}
      {!isLoading && templates.length === 0 ? <p className="empty-note">还没有卡券模板。</p> : null}

      <div className="admin-list">
        {templates.map((template) => {
          const config = readTemplateConfig(template);
          const hasPendingVersion = template.latestVersion?.status === 'PendingReview';

          return (
            <article className="admin-list-item" key={template.id}>
              <div>
                <h2>{config.displayName}</h2>
                <p>
                  {categoryLabels[template.category] ?? template.category} · {benefitLabels[template.benefitType] ?? template.benefitType} · 状态：
                  {template.status}
                </p>
                {template.latestVersion ? (
                  <p>
                    v{template.latestVersion.version} · {template.latestVersion.title} · 版本状态：{template.latestVersion.status}
                  </p>
                ) : null}
                {template.latestVersion?.description ? <p>{template.latestVersion.description}</p> : null}
                {template.latestVersion?.reviewReason ? <p>审核意见：{template.latestVersion.reviewReason}</p> : null}
              </div>
              <div className="admin-list-actions">
                <button
                  className="secondary-action"
                  type="button"
                  onClick={() => setDetailTemplate(template)}
                >
                  详情
                </button>
                <button
                  className="secondary-action"
                  type="button"
                  disabled={hasPendingVersion}
                  onClick={() => startTemplateEdit(template)}
                >
                  {hasPendingVersion ? '等待审核' : '提交新版'}
                </button>
              </div>
            </article>
          );
        })}
      </div>
      {editingTemplate
        ? (() => {
            const config = readTemplateConfig(editingTemplate);
            const variantOptions = buildVariantOptions(
              editingTemplate.category,
              templateVariants,
              config.variantKey,
            );
            const locationRules = readEditableLocationRules(editingTemplate.latestVersion?.locationRules);

            return (
              <div className="admin-dialog-layer">
                <button className="admin-dialog-scrim" type="button" aria-label="关闭弹窗" onClick={() => setEditingTemplateId(null)} />
                <section className="admin-dialog-panel" role="dialog" aria-modal="true" aria-label="提交模板新版本">
                  <div className="admin-dialog-heading">
                    <h2>提交新版本</h2>
                    <button className="icon-button" type="button" aria-label="关闭弹窗" onClick={() => setEditingTemplateId(null)}>
                      <span className="material-symbols-rounded" aria-hidden="true">
                        close
                      </span>
                    </button>
                  </div>
                  <form className="admin-dialog-form" onSubmit={(event) => void submitTemplateVersion(event, editingTemplate)} noValidate>
                    <span>需管理员审核，通过前不会影响当前可发放版本。</span>
                    <div className="admin-adjustment-panel provider-template-form">
                      <label>
                        <span>展示名称</span>
                        <input name="displayName" defaultValue={config.displayName} required minLength={2} maxLength={80} />
                      </label>
                      <label>
                        <span>卡面标题</span>
                        <input name="title" defaultValue={editingTemplate.latestVersion?.title ?? ''} required minLength={2} maxLength={80} />
                      </label>
                      <label>
                        <span>模板变体</span>
                        <select name="variantKey" defaultValue={config.variantKey}>
                          {variantOptions.map((variant) => (
                            <option value={variant.key} key={variant.key}>
                              {variant.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>卡面颜色</span>
                        <input name="cardColor" defaultValue={config.cardColor} maxLength={32} />
                      </label>
                    </div>
                    <label>
                      <span>说明</span>
                      <textarea name="description" defaultValue={editingTemplate.latestVersion?.description ?? ''} maxLength={1000} />
                    </label>
                    <label>
                      <span>背景图链接</span>
                      <input type="url" name="backgroundImageUrl" defaultValue={editingTemplate.latestVersion?.backgroundImageUrl ?? ''} maxLength={1000} />
                    </label>
                    <label>
                      <span>Logo 链接</span>
                      <input type="url" name="logoUrl" defaultValue={editingTemplate.latestVersion?.logoUrl ?? ''} maxLength={1000} />
                    </label>
                    <div className="template-rule-grid">
                      <label className="checkbox-row">
                        <input type="checkbox" name="shareable" defaultChecked={config.shareable} />
                        <span>允许通过链接分享领取入口</span>
                      </label>
                      <label className="checkbox-row">
                        <input type="checkbox" name="transferable" defaultChecked={config.transferable} />
                        <span>允许转赠</span>
                      </label>
                      <label className="checkbox-row">
                        <input type="checkbox" name="allowFrozenBalance" defaultChecked={config.allowFrozenBalance} />
                        <span>允许冻结余额/权益</span>
                      </label>
                      <label className="checkbox-row">
                        <input type="checkbox" name="allowTopUpIn" defaultChecked={config.allowTopUpIn} />
                        <span>允许被其他卡补充额度</span>
                      </label>
                      <label className="checkbox-row">
                        <input type="checkbox" name="allowTopUpOut" defaultChecked={config.allowTopUpOut} />
                        <span>允许作为额度补充来源</span>
                      </label>
                      <label className="checkbox-row">
                        <input type="checkbox" name="hideTitle" defaultChecked={config.hideTitle} />
                        <span>隐藏卡面标题</span>
                      </label>
                      <label className="checkbox-row">
                        <input type="checkbox" name="allowOverdraft" defaultChecked={config.allowOverdraft} />
                        <span>允许透支显示</span>
                      </label>
                      <label className="checkbox-row">
                        <input type="checkbox" name="requireServerVerifiedUser" defaultChecked={config.requireServerVerifiedUser} />
                        <span>领取时要求服务器账号已验证</span>
                      </label>
                    </div>
                    <label>
                      <span>允许核销方名单</span>
                      <textarea
                        name="allowedRedemptionProviderIdentifiers"
                        defaultValue={config.allowedRedemptionProviderIdentifiers}
                        maxLength={2000}
                        placeholder="留空时仅允许本发卡方核销；如需授权其他发卡方，可填写对方标识或 ID，多个用逗号或换行分隔。"
                      />
                    </label>
                    {editingTemplate.category === 'identity_key' ? (
                      <section className="stacked-form-subsection" aria-label="新版位置核验规则">
                        <div className="detail-section-heading">
                          <h2>位置核验</h2>
                          <span>跟随新版审核</span>
                        </div>
                        <div className="template-rule-grid">
                          <label className="checkbox-row">
                            <input type="checkbox" name="requireLocationVerification" defaultChecked={config.requireLocationVerification} />
                            <span>启用玩家位置范围核验</span>
                          </label>
                        </div>
                        <TemplateVersionLocationRulesEditor key={editingTemplate.id} initialRules={locationRules} />
                      </section>
                    ) : null}
                    <div className="form-actions">
                      <button className="secondary-action" type="button" onClick={() => setEditingTemplateId(null)}>
                        取消
                      </button>
                      <button className="primary-action" type="submit" disabled={isSubmittingVersion}>
                        <span className="material-symbols-rounded" aria-hidden="true">
                          approval
                        </span>
                        <span>{isSubmittingVersion ? '提交中' : '提交新版本审核'}</span>
                      </button>
                    </div>
                  </form>
                </section>
              </div>
            );
          })()
        : null}
      {detailTemplate ? (
        <div className="admin-dialog-layer">
          <button className="admin-dialog-scrim" type="button" aria-label="关闭弹窗" onClick={() => setDetailTemplate(null)} />
          <section className="admin-dialog-panel" role="dialog" aria-modal="true" aria-label="模板详情">
            <div className="admin-dialog-heading">
              <h2>{readTemplateConfig(detailTemplate).displayName}</h2>
              <button className="icon-button" type="button" aria-label="关闭弹窗" onClick={() => setDetailTemplate(null)}>
                <span className="material-symbols-rounded" aria-hidden="true">
                  close
                </span>
              </button>
            </div>
            <TemplateDetail template={detailTemplate} />
          </section>
        </div>
      ) : null}
    </section>
  );
}

type TemplateCategory = 'account' | 'identity_key' | 'ticket';

interface TemplateConfig {
  displayName: string;
  variantKey: string;
  cardColor: string;
  hideTitle: boolean;
  transferable: boolean;
  shareable: boolean;
  allowOverdraft: boolean;
  allowFrozenBalance: boolean;
  allowTopUpIn: boolean;
  allowTopUpOut: boolean;
  allowedRedemptionProviderIdentifiers: string;
  requireServerVerifiedUser: boolean;
  requireLocationVerification: boolean;
}

interface TemplatePreviewState {
  category: TemplateCategory;
  displayName: string;
  title: string;
  hideTitle: boolean;
  cardColor: string;
  backgroundImageUrl: string;
  logoUrl: string;
}

type LocationRuleDraft =
  | {
      draftId: string;
      persistedId?: string;
      kind: 'circle';
      label: string;
      centerX: string;
      centerZ: string;
      radius: string;
      expiresAfterSeconds: string;
    }
  | {
      draftId: string;
      persistedId?: string;
      kind: 'rectangle';
      label: string;
      minX: string;
      maxX: string;
      minZ: string;
      maxZ: string;
      expiresAfterSeconds: string;
    };

function TemplateCardPreview({ preview }: { preview: TemplatePreviewState }) {
  const style = {
    ...(preview.cardColor ? { backgroundColor: preview.cardColor } : {}),
    ...(preview.backgroundImageUrl
      ? {
          backgroundImage: `linear-gradient(180deg, rgba(0, 0, 0, 0.08), rgba(0, 0, 0, 0.26)), url("${preview.backgroundImageUrl}")`,
        }
      : {}),
  };

  return (
    <section className={`template-card-preview template-card-preview-${preview.category}`} aria-label="卡面预览">
      <div className="template-preview-pass" style={style}>
        <small>**** 5678</small>
      </div>
      <div className="template-preview-info">
        <span>{categoryLabels[preview.category]}</span>
        <strong>{preview.displayName}</strong>
        <small>{preview.hideTitle ? '标题已隐藏' : preview.title}</small>
        {preview.logoUrl ? <small>Logo：{preview.logoUrl}</small> : null}
      </div>
    </section>
  );
}

function TemplateDetail({ template }: { template: ProviderTemplate }) {
  const config = readTemplateConfig(template);

  return (
    <>
      <TemplateCardPreview
        preview={{
          category: isTemplateCategory(template.category) ? template.category : 'account',
          displayName: config.displayName,
          title: template.latestVersion?.title ?? template.displayName,
          hideTitle: config.hideTitle,
          cardColor: config.cardColor,
          backgroundImageUrl: template.latestVersion?.backgroundImageUrl ?? '',
          logoUrl: template.latestVersion?.logoUrl ?? '',
        }}
      />
      <dl className="admin-detail-list">
        <div>
          <dt>分类</dt>
          <dd>{categoryLabels[template.category] ?? template.category}</dd>
        </div>
        <div>
          <dt>权益类型</dt>
          <dd>{benefitLabels[template.benefitType] ?? template.benefitType}</dd>
        </div>
        <div>
          <dt>模板状态</dt>
          <dd>{template.status}</dd>
        </div>
        <div>
          <dt>当前版本</dt>
          <dd>{template.latestVersion ? `v${template.latestVersion.version} · ${template.latestVersion.status}` : '暂无版本'}</dd>
        </div>
        <div>
          <dt>标题</dt>
          <dd>{template.latestVersion?.title ?? '未设置'}</dd>
        </div>
        <div>
          <dt>说明</dt>
          <dd>{template.latestVersion?.description ?? '未填写'}</dd>
        </div>
        <div>
          <dt>背景图</dt>
          <dd>{template.latestVersion?.backgroundImageUrl ?? '未设置'}</dd>
        </div>
        <div>
          <dt>Logo</dt>
          <dd>{template.latestVersion?.logoUrl ?? '未设置'}</dd>
        </div>
        <div>
          <dt>规则摘要</dt>
          <dd>
            {[
              config.shareable ? '允许分享' : '不允许分享',
              config.transferable ? '允许转赠' : '不允许转赠',
              config.allowTopUpIn ? '允许补充' : '不允许补充',
              config.requireServerVerifiedUser ? '领取需服务器验证' : '领取不要求服务器验证',
            ].join('；')}
          </dd>
        </div>
        {template.latestVersion?.reviewReason ? (
          <div>
            <dt>审核意见</dt>
            <dd>{template.latestVersion.reviewReason}</dd>
          </div>
        ) : null}
      </dl>
    </>
  );
}

function TemplateVersionLocationRulesEditor({ initialRules }: { initialRules: LocationRuleDraft[] }) {
  const [rules, setRules] = useState<LocationRuleDraft[]>(() =>
    initialRules.length ? initialRules : [createLocationRuleDraft('circle')],
  );

  return (
    <LocationRulesEditor
      rules={rules}
      onChange={setRules}
      summary="现有范围会随新版本一并提交审核，命中任意一个范围即通过。"
    />
  );
}

function LocationRulesEditor({
  rules,
  onChange,
  summary,
}: {
  rules: LocationRuleDraft[];
  onChange: (rules: LocationRuleDraft[]) => void;
  summary: string;
}) {
  const visibleRules = rules.length ? rules : [createLocationRuleDraft('circle')];

  const replaceRule = (nextRule: LocationRuleDraft) => {
    onChange(visibleRules.map((rule) => (rule.draftId === nextRule.draftId ? nextRule : rule)));
  };

  const removeRule = (draftId: string) => {
    const nextRules = visibleRules.filter((rule) => rule.draftId !== draftId);
    onChange(nextRules.length ? nextRules : [createLocationRuleDraft('circle')]);
  };

  return (
    <div className="location-rules-editor">
      <input type="hidden" name="locationRulesJson" value={serializeLocationRules(visibleRules)} />
      <div className="location-rules-toolbar">
        <p>{summary}</p>
        <div className="admin-list-actions">
          <button
            className="secondary-action"
            type="button"
            disabled={visibleRules.length >= 10}
            onClick={() => onChange([...visibleRules, createLocationRuleDraft('circle')])}
          >
            添加圆形范围
          </button>
          <button
            className="secondary-action"
            type="button"
            disabled={visibleRules.length >= 10}
            onClick={() => onChange([...visibleRules, createLocationRuleDraft('rectangle')])}
          >
            添加矩形范围
          </button>
        </div>
      </div>

      <div className="location-rule-list">
        {visibleRules.map((rule, index) => (
          <article className="location-rule-card" key={rule.draftId}>
            <div className="location-rule-heading">
              <strong>范围 {index + 1}</strong>
              <div className="admin-list-actions">
                <select
                  aria-label={`范围 ${index + 1} 类型`}
                  value={rule.kind}
                  onChange={(event) => replaceRule(convertLocationRuleKind(rule, event.target.value as LocationRuleDraft['kind']))}
                >
                  <option value="circle">圆形范围</option>
                  <option value="rectangle">矩形范围</option>
                </select>
                <button className="secondary-action danger-action" type="button" onClick={() => removeRule(rule.draftId)}>
                  删除
                </button>
              </div>
            </div>
            <div className="admin-adjustment-panel provider-template-form location-rule-fields">
              <label>
                <span>范围名称</span>
                <input
                  value={rule.label}
                  onChange={(event) => replaceRule({ ...rule, label: event.target.value })}
                  placeholder="例如：北门入口"
                  maxLength={60}
                />
              </label>
              <label>
                <span>位置有效秒数</span>
                <input
                  type="number"
                  min={10}
                  max={300}
                  value={rule.expiresAfterSeconds}
                  onChange={(event) => replaceRule({ ...rule, expiresAfterSeconds: event.target.value })}
                />
              </label>
              {rule.kind === 'circle' ? (
                <>
                  <label>
                    <span>中心 X</span>
                    <input
                      inputMode="decimal"
                      value={rule.centerX}
                      onChange={(event) => replaceRule({ ...rule, centerX: event.target.value })}
                      placeholder="0"
                    />
                  </label>
                  <label>
                    <span>中心 Z</span>
                    <input
                      inputMode="decimal"
                      value={rule.centerZ}
                      onChange={(event) => replaceRule({ ...rule, centerZ: event.target.value })}
                      placeholder="0"
                    />
                  </label>
                  <label>
                    <span>半径</span>
                    <input
                      inputMode="decimal"
                      value={rule.radius}
                      onChange={(event) => replaceRule({ ...rule, radius: event.target.value })}
                      placeholder="20"
                    />
                  </label>
                </>
              ) : (
                <>
                  <label>
                    <span>最小 X</span>
                    <input
                      inputMode="decimal"
                      value={rule.minX}
                      onChange={(event) => replaceRule({ ...rule, minX: event.target.value })}
                      placeholder="-10"
                    />
                  </label>
                  <label>
                    <span>最大 X</span>
                    <input
                      inputMode="decimal"
                      value={rule.maxX}
                      onChange={(event) => replaceRule({ ...rule, maxX: event.target.value })}
                      placeholder="10"
                    />
                  </label>
                  <label>
                    <span>最小 Z</span>
                    <input
                      inputMode="decimal"
                      value={rule.minZ}
                      onChange={(event) => replaceRule({ ...rule, minZ: event.target.value })}
                      placeholder="-10"
                    />
                  </label>
                  <label>
                    <span>最大 Z</span>
                    <input
                      inputMode="decimal"
                      value={rule.maxZ}
                      onChange={(event) => replaceRule({ ...rule, maxZ: event.target.value })}
                      placeholder="10"
                    />
                  </label>
                </>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function readTemplateConfig(template: ProviderTemplate): TemplateConfig {
  const fields = asRecord(template.latestVersion?.fields);
  const cardStyle = asRecord(template.latestVersion?.cardStyle);
  const rules = asRecord(template.latestVersion?.rules);

  return {
    displayName: readString(fields?.primary) || template.displayName,
    variantKey: readString(cardStyle?.variantKey) || 'standard',
    cardColor: readString(cardStyle?.cardColor) || '',
    hideTitle: readBoolean(fields?.hideTitle, false),
    transferable: readBoolean(rules?.transferable, false),
    shareable: readBoolean(rules?.shareable, true),
    allowOverdraft: readBoolean(rules?.allowOverdraft, false),
    allowFrozenBalance: readBoolean(rules?.allowFrozenBalance, true),
    allowTopUpIn: readBoolean(rules?.allowTopUpIn, false),
    allowTopUpOut: readBoolean(rules?.allowTopUpOut, false),
    allowedRedemptionProviderIdentifiers: readStringArray(rules?.allowedRedemptionProviderIds).join('\n'),
    requireServerVerifiedUser: readBoolean(rules?.requireServerVerifiedUser, false),
    requireLocationVerification: readBoolean(rules?.requireLocationVerification, false),
  };
}

function buildVariantOptions(category: string, variants: CardTemplateVariant[], currentVariantKey: string): Array<{ key: string; name: string }> {
  const safeCategory = isTemplateCategory(category) ? category : 'account';
  const options = variants
    .filter((variant) => variant.enabled && variant.category === safeCategory)
    .map((variant) => ({
      key: variant.key,
      name: variant.name,
    }));
  const fallbackOptions = options.length ? options : fallbackTemplateVariants[safeCategory];

  if (!currentVariantKey || fallbackOptions.some((option) => option.key === currentVariantKey)) {
    return fallbackOptions;
  }

  return [{ key: currentVariantKey, name: `当前变体：${currentVariantKey}` }, ...fallbackOptions];
}

function readEditableLocationRules(value: unknown): LocationRuleDraft[] {
  const root = asRecord(value);
  const rules = Array.isArray(value) ? value : Array.isArray(root?.rules) ? root.rules : [];

  return rules
    .map((rule, index) => readEditableLocationRule(rule, index))
    .filter((rule): rule is LocationRuleDraft => rule !== null);
}

function readEditableLocationRule(value: unknown, index: number): LocationRuleDraft | null {
  const candidate = asRecord(value);
  if (!candidate) {
    return null;
  }

  const kind = readString(candidate.kind);
  const label = readString(candidate.label) || '默认核验范围';
  const expiresAfterSeconds = readNumberInput(candidate.expiresAfterSeconds, '60');
  const persistedId = readString(candidate.id) || undefined;

  if (kind === 'rectangle') {
    return {
      kind,
      draftId: createDraftId(),
      ...(persistedId ? { persistedId } : {}),
      label,
      minX: readNumberInput(candidate.minX, '-10'),
      maxX: readNumberInput(candidate.maxX, '10'),
      minZ: readNumberInput(candidate.minZ, '-10'),
      maxZ: readNumberInput(candidate.maxZ, '10'),
      expiresAfterSeconds,
    };
  }

  if (kind === 'circle') {
    return {
      kind,
      draftId: createDraftId(),
      ...(persistedId ? { persistedId } : {}),
      label,
      centerX: readNumberInput(candidate.centerX, '0'),
      centerZ: readNumberInput(candidate.centerZ, '0'),
      radius: readNumberInput(candidate.radius, '20'),
      expiresAfterSeconds,
    };
  }

  return null;
}

function createLocationRuleDraft(kind: LocationRuleDraft['kind']): LocationRuleDraft {
  if (kind === 'rectangle') {
    return {
      draftId: createDraftId(),
      kind,
      label: '默认核验范围',
      minX: '-10',
      maxX: '10',
      minZ: '-10',
      maxZ: '10',
      expiresAfterSeconds: '60',
    };
  }

  return {
    draftId: createDraftId(),
    kind,
    label: '默认核验范围',
    centerX: '0',
    centerZ: '0',
    radius: '20',
    expiresAfterSeconds: '60',
  };
}

function convertLocationRuleKind(rule: LocationRuleDraft, nextKind: LocationRuleDraft['kind']): LocationRuleDraft {
  if (rule.kind === nextKind) {
    return rule;
  }

  if (nextKind === 'rectangle') {
    const centerX = Number(rule.kind === 'circle' ? rule.centerX : 0);
    const centerZ = Number(rule.kind === 'circle' ? rule.centerZ : 0);
    const radius = Number(rule.kind === 'circle' ? rule.radius : 10);
    const safeCenterX = Number.isFinite(centerX) ? centerX : 0;
    const safeCenterZ = Number.isFinite(centerZ) ? centerZ : 0;
    const safeRadius = Number.isFinite(radius) && radius > 0 ? radius : 10;

    return {
      draftId: rule.draftId,
      ...(rule.persistedId ? { persistedId: rule.persistedId } : {}),
      kind: nextKind,
      label: rule.label,
      minX: String(safeCenterX - safeRadius),
      maxX: String(safeCenterX + safeRadius),
      minZ: String(safeCenterZ - safeRadius),
      maxZ: String(safeCenterZ + safeRadius),
      expiresAfterSeconds: rule.expiresAfterSeconds,
    };
  }

  const minX = Number(rule.kind === 'rectangle' ? rule.minX : -10);
  const maxX = Number(rule.kind === 'rectangle' ? rule.maxX : 10);
  const minZ = Number(rule.kind === 'rectangle' ? rule.minZ : -10);
  const maxZ = Number(rule.kind === 'rectangle' ? rule.maxZ : 10);
  const safeMinX = Number.isFinite(minX) ? minX : -10;
  const safeMaxX = Number.isFinite(maxX) ? maxX : 10;
  const safeMinZ = Number.isFinite(minZ) ? minZ : -10;
  const safeMaxZ = Number.isFinite(maxZ) ? maxZ : 10;
  const radius = Math.max(Math.abs(safeMaxX - safeMinX), Math.abs(safeMaxZ - safeMinZ)) / 2 || 10;

  return {
    draftId: rule.draftId,
    ...(rule.persistedId ? { persistedId: rule.persistedId } : {}),
    kind: nextKind,
    label: rule.label,
    centerX: String((safeMinX + safeMaxX) / 2),
    centerZ: String((safeMinZ + safeMaxZ) / 2),
    radius: String(radius),
    expiresAfterSeconds: rule.expiresAfterSeconds,
  };
}

function serializeLocationRules(rules: LocationRuleDraft[]): string {
  return JSON.stringify(
    rules.map((rule, index) => {
      const base = {
        ...(rule.persistedId ? { id: rule.persistedId } : {}),
        kind: rule.kind,
        label: rule.label.trim() || `位置范围 ${index + 1}`,
        expiresAfterSeconds: rule.expiresAfterSeconds.trim() || '60',
      };

      if (rule.kind === 'rectangle') {
        return {
          ...base,
          minX: rule.minX.trim(),
          maxX: rule.maxX.trim(),
          minZ: rule.minZ.trim(),
          maxZ: rule.maxZ.trim(),
        };
      }

      return {
        ...base,
        centerX: rule.centerX.trim(),
        centerZ: rule.centerZ.trim(),
        radius: rule.radius.trim(),
      };
    }),
    null,
    2,
  );
}

let locationRuleDraftCounter = 0;

function createDraftId(): string {
  locationRuleDraftCounter += 1;
  return `location-rule-${locationRuleDraftCounter}`;
}

function isTemplateCategory(value: string): value is TemplateCategory {
  return value === 'account' || value === 'identity_key' || value === 'ticket';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function readNumberInput(value: unknown, fallback: string): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }

  return fallback;
}
