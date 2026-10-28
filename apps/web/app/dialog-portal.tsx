'use client';

import { type ReactNode, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * 把浮层提升到 document.body，避免祖先的滤镜/变换成为 position: fixed 的包含块，
 * 让遮罩始终覆盖整个窗口。active=false 时保持原位（用于详情面板内联模块）。
 */
export function DialogPortal({
  active = true,
  children,
}: {
  active?: boolean;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!active) {
    return <>{children}</>;
  }

  if (!mounted) {
    return null;
  }

  return createPortal(children, document.body);
}
