'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

interface ClaimLinkToolsProps {
  claimCode: string;
  claimLink: string;
  title?: string;
  onMessage?: (message: string) => void;
}

export function ClaimLinkTools({ claimCode, claimLink, title = '添加链接', onMessage }: ClaimLinkToolsProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrMessage, setQrMessage] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    setQrDataUrl(null);
    setQrMessage(null);

    QRCode.toDataURL(claimLink, {
      errorCorrectionLevel: 'M',
      margin: 1,
      scale: 6,
      type: 'image/png',
      color: {
        dark: '#111816',
        light: '#ffffff',
      },
    })
      .then((dataUrl) => {
        if (isMounted) {
          setQrDataUrl(dataUrl);
        }
      })
      .catch(() => {
        if (isMounted) {
          setQrMessage('二维码生成失败，请先复制添加链接。');
        }
      });

    return () => {
      isMounted = false;
    };
  }, [claimLink]);

  const copyClaimCode = async () => {
    await copyText(claimCode, '领取码已复制。', onMessage);
  };

  const copyClaimLink = async () => {
    await copyText(claimLink, '添加链接已复制。', onMessage);
  };

  return (
    <div className="claim-link-tools">
      <div className="claim-link-copy">
        <strong>{title}</strong>
        <span>{claimLink}</span>
        <small>领取码：{claimCode}</small>
        <div className="admin-list-actions">
          <button className="secondary-action" type="button" onClick={() => void copyClaimCode()}>
            <span className="material-symbols-rounded" aria-hidden="true">
              content_copy
            </span>
            <span>复制领取码</span>
          </button>
          <button className="secondary-action" type="button" onClick={() => void copyClaimLink()}>
            <span className="material-symbols-rounded" aria-hidden="true">
              link
            </span>
            <span>复制链接</span>
          </button>
          <a className="primary-action" href={toPathOnly(claimLink)}>
            <span className="material-symbols-rounded" aria-hidden="true">
              open_in_new
            </span>
            <span>打开添加页</span>
          </a>
        </div>
      </div>
      <div className="claim-link-qr" aria-label="添加链接二维码">
        {qrDataUrl ? <img src={qrDataUrl} alt="添加链接二维码" width={164} height={164} /> : <span>正在生成二维码</span>}
        {qrDataUrl ? (
          <a className="secondary-action" href={qrDataUrl} download={`ldpass-${claimCode}.png`}>
            <span className="material-symbols-rounded" aria-hidden="true">
              download
            </span>
            <span>下载二维码</span>
          </a>
        ) : null}
        {qrMessage ? <small>{qrMessage}</small> : null}
      </div>
    </div>
  );
}

async function copyText(value: string, successMessage: string, onMessage?: (message: string) => void) {
  try {
    await window.navigator.clipboard.writeText(value);
    onMessage?.(successMessage);
  } catch {
    onMessage?.('当前浏览器无法自动复制，请手动选择文本复制。');
  }
}

function toPathOnly(value: string): string {
  try {
    const url = new URL(value, window.location.origin);
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return value;
  }
}
