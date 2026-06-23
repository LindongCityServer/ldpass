'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { getJson, postJson } from '../../api-client';

type LegalDocumentKey = 'terms' | 'privacy';

interface LegalDocument {
  key: LegalDocumentKey;
  title: string;
  content: string;
  updatedById: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  isDefault: boolean;
}

interface LegalDocumentsResponse {
  documents: LegalDocument[];
}

const documentTabs: Array<{ key: LegalDocumentKey; label: string; icon: string }> = [
  { key: 'terms', label: '服务条款', icon: 'contract' },
  { key: 'privacy', label: '隐私政策', icon: 'privacy_tip' },
];

export function AdminLegalDocumentsPanel() {
  const [documents, setDocuments] = useState<LegalDocument[]>([]);
  const [activeKey, setActiveKey] = useState<LegalDocumentKey>('terms');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const activeDocument = useMemo(
    () => documents.find((document) => document.key === activeKey) ?? null,
    [activeKey, documents],
  );

  const loadDocuments = async () => {
    setIsLoading(true);
    setMessage(null);

    try {
      const result = await getJson<LegalDocumentsResponse>('/api/admin/legal/documents');
      setDocuments(result.documents);
      const nextDocument =
        result.documents.find((document) => document.key === activeKey) ??
        result.documents[0] ??
        null;
      setTitle(nextDocument?.title ?? '');
      setContent(nextDocument?.content ?? '');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '读取协议文档失败。');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadDocuments();
  }, []);

  const selectDocument = (key: LegalDocumentKey) => {
    setActiveKey(key);
    const nextDocument = documents.find((document) => document.key === key);
    setTitle(nextDocument?.title ?? '');
    setContent(nextDocument?.content ?? '');
    setMessage(null);
  };

  const saveDocument = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSaving(true);
    setMessage(null);

    try {
      const result = await postJson<LegalDocument>(`/api/admin/legal/documents/${activeKey}`, {
        title,
        content,
      });
      setDocuments((currentDocuments) =>
        currentDocuments.map((document) => (document.key === result.key ? result : document)),
      );
      setTitle(result.title);
      setContent(result.content);
      setMessage(`${result.title} 已保存并写入审计。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存协议文档失败。');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="admin-panel" aria-labelledby="admin-legal-title">
      <div className="admin-panel-heading">
        <div>
          <p>平台管理</p>
          <h1 id="admin-legal-title">协议文档</h1>
        </div>
        <div className="admin-list-actions">
          <a className="secondary-action" href="/admin/audit">
            审计记录
          </a>
          <a className="secondary-action" href="/admin/users">
            用户审核
          </a>
        </div>
      </div>

      <div className="segmented-control legal-document-tabs" role="tablist" aria-label="协议文档">
        {documentTabs.map((tab) => (
          <button
            className={activeKey === tab.key ? 'is-selected' : ''}
            type="button"
            role="tab"
            aria-selected={activeKey === tab.key}
            key={tab.key}
            onClick={() => selectDocument(tab.key)}
          >
            <span className="material-symbols-rounded" aria-hidden="true">
              {tab.icon}
            </span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {message ? (
        <div className="flow-notice" role="status" aria-live="polite">
          <span>{message}</span>
        </div>
      ) : null}

      {isLoading ? <p className="empty-note">正在读取协议文档。</p> : null}

      <form className="stacked-form legal-document-form" onSubmit={saveDocument} noValidate>
        <label>
          <span>标题</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
            minLength={2}
            maxLength={120}
          />
        </label>
        <label>
          <span>正文</span>
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            required
            minLength={20}
            maxLength={20000}
          />
        </label>
        <p className="empty-note">
          {activeDocument?.isDefault
            ? '当前展示的是系统占位文本，保存后才会作为正式内容发布。'
            : activeDocument?.updatedAt
              ? `最后更新：${new Date(activeDocument.updatedAt).toLocaleString('zh-CN')}`
              : '尚未保存。'}
        </p>
        <div className="form-actions">
          <a
            className="secondary-action"
            href={`/legal/${activeKey}`}
            target="_blank"
            rel="noreferrer"
          >
            预览公开页
          </a>
          <button className="primary-action" type="submit" disabled={isSaving || isLoading}>
            <span className="material-symbols-rounded" aria-hidden="true">
              save
            </span>
            <span>{isSaving ? '保存中' : '保存文档'}</span>
          </button>
        </div>
      </form>
    </section>
  );
}
