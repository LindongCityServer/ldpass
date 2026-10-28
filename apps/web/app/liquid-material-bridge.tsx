'use client';

import { useEffect } from 'react';
import { createLiquidMaterialMap } from './liquid-material';
import {
  readUiEffectsPreference,
  resolveEffectiveMaterialMode,
  subscribeUiEffectsPreferenceChanged,
} from './ui-effects-preference';
import { useMaterialContentShadows } from './use-material-content-shadows';

// 透光材质候选名单；实际嵌在另一块材质内的普通控件不再注册第二层滤镜。
// 首页与后台侧边栏容器本身不承载材质，只把选中项注册为液态表面。
const surfaceSelector = [
  '.topbar-actions',
  '.backoffice-topbar-actions',
  '.auth-topbar > .theme-settings',
  '.backoffice-topbar > .backoffice-topbar-back',
  '.theme-popover',
  '.category-rail > .category-item.is-active',
  '.backoffice-nav a.is-active',
  '.backoffice-mobile-nav-group a.is-active',
  '.detail-panel',
  '.detail-module-slot.is-dialog .detail-module-panel',
  '.admin-dialog-panel',
  '.backoffice-page-actions-floating',
].join(',');

// 弹窗/浮层内部新增的“独立材质表面”：它们嵌在已有材质内，但需要作为
// root 单独注册（对话框、主题弹窗），不能被嵌套判定降级为 nested。
const standaloneFloatingSurfaceSelector = [
  '.detail-module-slot.is-dialog .detail-module-panel',
  '.admin-dialog-panel',
  '.theme-popover',
].join(', ');

const svgNamespace = 'http://www.w3.org/2000/svg';
let nextFilterId = 0;

/**
 * 判断浏览器是否真的能用 SVG 引用做 backdrop-filter。
 * Safari / iOS 全版本都不支持，但 CSS.supports 的语法检测会把它误判为支持；
 * 一旦写入 url(...)，Safari 会丢掉整条滤镜（连普通模糊一起失效），
 * 因此这里对 WebKit（非 Chromium）直接降级为普通模糊。
 */
function supportsDistortionFilter() {
  if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') return false;
  if (!CSS.supports('backdrop-filter', 'url("#ldpass-liquid-probe")')) return false;
  const userAgent = navigator.userAgent;
  return !/AppleWebKit/i.test(userAgent) || /Chrome|Chromium|Edg|OPR/i.test(userAgent);
}

function resolveRadiusPart(value: string, size: number) {
  const trimmed = value.trim();
  if (trimmed.endsWith('%')) return (Number.parseFloat(trimmed) / 100) * size;
  const pixels = Number.parseFloat(trimmed);
  return Number.isFinite(pixels) ? pixels : 0;
}

function getEffectiveBorderRadius(element: HTMLElement, width: number, height: number) {
  const style = getComputedStyle(element);
  const corners = [
    style.borderTopLeftRadius,
    style.borderTopRightRadius,
    style.borderBottomRightRadius,
    style.borderBottomLeftRadius,
  ];
  const radius = corners.reduce((maximum, value) => {
    const [horizontal = '0', vertical = horizontal] = value.split(/\s+/);
    return Math.max(
      maximum,
      resolveRadiusPart(horizontal, width),
      resolveRadiusPart(vertical, height),
    );
  }, 0);
  return Math.min(radius, width / 2, height / 2);
}

function svgElement<K extends keyof SVGElementTagNameMap>(
  name: K,
  attributes: Record<string, string>,
) {
  const element = document.createElementNS(svgNamespace, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}

interface Surface {
  filter: SVGFilterElement;
  image: SVGFEImageElement;
  transfer: SVGFEComponentTransferElement;
  displacement: SVGFEDisplacementMapElement;
  key: string;
}

export function LiquidMaterialBridge() {
  // 内容阴影独立于 SVG 扭曲能力，普通模糊降级时也要正确处理有底色的子元素。
  useMaterialContentShadows('[data-liquid-material]');
  useEffect(() => {
    const supportsDistortion = supportsDistortionFilter();

    const host = svgElement('svg', {
      class: 'ldpass-material-filter-defs',
      width: '0',
      height: '0',
      'aria-hidden': 'true',
      focusable: 'false',
    });
    const defs = svgElement('defs', {});
    host.append(defs);
    document.body.append(host);
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    let preference = readUiEffectsPreference();
    let frame = 0;
    const surfaces = new Map<HTMLElement, Surface>();
    const materialElements = new Set<HTMLElement>();
    const nestedElements = new Set<HTMLElement>();
    const pending = new Set<HTMLElement>();

    function render(element: HTMLElement, surface: Surface) {
      const width = element.offsetWidth;
      const height = element.offsetHeight;
      if (!width || !height) return;
      const radius = getEffectiveBorderRadius(element, width, height);
      const key = `${width}:${height}:${preference.materialThickness}:${radius}`;
      if (surface.key === key) return;
      surface.key = key;
      const map = createLiquidMaterialMap(width, height, preference.materialThickness, radius);
      canvas.width = map.mapWidth;
      canvas.height = map.mapHeight;
      const image = context!.createImageData(map.mapWidth, map.mapHeight);
      image.data.set(map.pixels);
      context!.putImageData(image, 0, 0);
      // 滤镜与图像使用控件的实际 CSS 尺寸，不能让百分比参照隐藏 SVG 的视口。
      for (const part of [surface.filter, surface.image, surface.transfer, surface.displacement]) {
        part.setAttribute('width', String(width));
        part.setAttribute('height', String(height));
      }
      surface.image.setAttribute('href', canvas.toDataURL('image/png'));
      surface.displacement.setAttribute('scale', String(map.scale));
      element.style.setProperty(
        '--ldpass-material-distortion-filter',
        `url("#${surface.filter.id}")`,
      );
      element.dataset.liquidMaterial = '';
    }

    function schedule(element: HTMLElement) {
      pending.add(element);
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        for (const item of pending) {
          const surface = surfaces.get(item);
          if (surface && item.isConnected) render(item, surface);
        }
        pending.clear();
      });
    }

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) schedule(entry.target as HTMLElement);
    });

    function remove(element: HTMLElement) {
      resizeObserver.unobserve(element);
      pending.delete(element);
      surfaces.get(element)?.filter.remove();
      surfaces.delete(element);
      materialElements.delete(element);
      element.style.removeProperty('--ldpass-material-distortion-filter');
      delete element.dataset.liquidMaterial;
    }

    function register(element: HTMLElement) {
      // 即使浏览器仅支持普通模糊，材质层级和交互样式也使用同一个标记。
      materialElements.add(element);
      element.dataset.liquidMaterial = '';
      if (!supportsDistortion || !context) return;
      if (surfaces.has(element)) return;
      const filter = svgElement('filter', {
        id: `ldpass-liquid-${++nextFilterId}`,
        x: '0',
        y: '0',
        filterUnits: 'userSpaceOnUse',
        primitiveUnits: 'userSpaceOnUse',
        'color-interpolation-filters': 'sRGB',
      });
      const image = svgElement('feImage', {
        x: '0',
        y: '0',
        preserveAspectRatio: 'none',
        result: 'edge-map',
      });
      const transfer = svgElement('feComponentTransfer', {
        in: 'edge-map',
        result: 'calibrated-map',
        x: '0',
        y: '0',
      });
      transfer.append(
        svgElement('feFuncR', {
          type: 'linear',
          slope: String(255 / 254),
          intercept: String(-1 / 254),
        }),
        svgElement('feFuncG', {
          type: 'linear',
          slope: String(255 / 254),
          intercept: String(-1 / 254),
        }),
      );
      const displacement = svgElement('feDisplacementMap', {
        in: 'SourceGraphic',
        in2: 'calibrated-map',
        x: '0',
        y: '0',
        xChannelSelector: 'R',
        yChannelSelector: 'G',
      });
      filter.append(image, transfer, displacement);
      defs.append(filter);
      surfaces.set(element, { filter, image, transfer, displacement, key: '' });
      resizeObserver.observe(element);
      schedule(element);
    }

    function refresh() {
      const candidates =
        resolveEffectiveMaterialMode(preference) === 'advanced'
          ? Array.from(document.querySelectorAll<HTMLElement>(surfaceSelector))
          : [];
      const roots = new Set<HTMLElement>();
      const nested = new Set<HTMLElement>();
      for (const element of candidates) {
        const ancestor = element.parentElement?.closest(surfaceSelector);
        // 展开的对话框/弹窗在父控件外单独浮动，仍然是一块独立材质。
        const isFloatingPanel =
          (element.matches('.theme-popover, .topbar-actions, .backoffice-topbar-actions') &&
            ['absolute', 'fixed'].includes(getComputedStyle(element).position)) ||
          element.matches(standaloneFloatingSurfaceSelector);
        (ancestor && !isFloatingPanel ? nested : roots).add(element);
      }
      for (const element of materialElements) {
        if (!roots.has(element)) remove(element);
      }
      for (const element of nestedElements) {
        if (!nested.has(element)) {
          delete element.dataset.materialNested;
          nestedElements.delete(element);
        }
      }
      for (const element of nested) {
        element.dataset.materialNested = '';
        nestedElements.add(element);
      }
      roots.forEach(register);
      surfaces.forEach((_, element) => schedule(element));
    }

    let refreshFrame = 0;
    const queueRefresh = () => {
      if (refreshFrame) return;
      refreshFrame = requestAnimationFrame(() => {
        refreshFrame = 0;
        refresh();
      });
    };

    // 性能闸门：整站 class/DOM 变动极频繁，而 refresh 会对多个复杂选择器做全文档扫描。
    // 先做廉价判断，只有变更可能影响候选表面集合（节点自身/祖先/子树命中选择器）时才刷新。
    function elementTouchesSurface(node: Node): boolean {
      if (node.nodeType !== Node.ELEMENT_NODE) return false;
      const element = node as HTMLElement;
      return Boolean(
        element.matches(surfaceSelector) ||
        element.closest(surfaceSelector) ||
        element.querySelector(surfaceSelector),
      );
    }

    function mutationIsRelevant(record: MutationRecord): boolean {
      if (record.type === 'attributes') {
        // 选中项切换时旧节点会失去候选资格，必须靠已注册集合把它清理掉。
        return (
          elementTouchesSurface(record.target) ||
          (record.target instanceof HTMLElement && materialElements.has(record.target))
        );
      }
      for (const node of record.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        const element = node as HTMLElement;
        // 新挂载节点可能就是候选、包含候选，或被挂到某个候选之下（影响嵌套判定）。
        if (
          element.matches(surfaceSelector) ||
          element.querySelector(surfaceSelector) ||
          element.parentElement?.closest(surfaceSelector)
        ) {
          return true;
        }
      }
      for (const node of record.removedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        const element = node as HTMLElement;
        if (element.matches(surfaceSelector) || element.querySelector(surfaceSelector)) {
          return true;
        }
      }
      return false;
    }

    const mutationObserver = new MutationObserver((records) => {
      // 忽略滤镜自身的更新，避免生成 PNG 触发下一轮自身重绘；
      // 与材质表面无关的高频变动直接跳过。
      if (records.every((record) => host.contains(record.target))) return;
      if (records.some(mutationIsRelevant)) queueRefresh();
    });
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    });
    const unsubscribe = subscribeUiEffectsPreferenceChanged(({ preference: next }) => {
      preference = next;
      refresh();
    });
    refresh();

    return () => {
      unsubscribe();
      mutationObserver.disconnect();
      resizeObserver.disconnect();
      cancelAnimationFrame(frame);
      cancelAnimationFrame(refreshFrame);
      for (const element of materialElements) remove(element);
      for (const element of nestedElements) delete element.dataset.materialNested;
      host.remove();
    };
  }, []);

  return null;
}
