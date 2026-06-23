'use client';

import { useEffect, useState } from 'react';
import { getJson } from '../../api-client';

interface LegalDocument {
  key: string;
  title: string;
  content: string;
  updatedAt: string | null;
  isDefault: boolean;
}

interface LegalDocumentViewerProps {
  documentKey: string;
}

export function LegalDocumentViewer({ documentKey }: LegalDocumentViewerProps) {
  const [document, setDocument] = useState<LegalDocument | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const loadDocument = async () => {
      setIsLoading(true);
      setMessage(null);

      try {
        const result = await getJson<LegalDocument>(`/api/legal/documents/${documentKey}`);
        if (isMounted) {
          setDocument(result);
        }
      } catch (error) {
        if (isMounted) {
          setMessage(error instanceof Error ? error.message : '读取协议文档失败。');
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    void loadDocument();

    return () => {
      isMounted = false;
    };
  }, [documentKey]);

  return (
    <article className="admin-panel legal-document-panel" aria-labelledby="legal-document-title">
      <div className="admin-panel-heading">
        <div>
          <p>协议文档</p>
          <h1 id="legal-document-title">{document?.title ?? readDocumentLabel(documentKey)}</h1>
        </div>
        <a className="secondary-action" href="/login">
          返回登录
        </a>
      </div>

      {message ? (
        <div className="flow-notice flow-notice-warning" role="status" aria-live="polite">
          <strong>读取失败</strong>
          <span>{message}</span>
        </div>
      ) : null}

      {isLoading ? <p className="empty-note">正在读取协议文档。</p> : null}

      {document ? (
        <>
          <p className="empty-note">
            {document.updatedAt
              ? `最后更新：${new Date(document.updatedAt).toLocaleString('zh-CN')}`
              : '管理员尚未发布正式版本。'}
          </p>
          <pre className="legal-document-content">{document.content}</pre>
        </>
      ) : null}
    </article>
  );
}

function readDocumentLabel(key: string): string {
  const labels: Record<string, string> = {
    terms: '服务条款',
    privacy: '隐私政策',
  };

  return labels[key] ?? '协议文档';
}
