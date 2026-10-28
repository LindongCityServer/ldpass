'use client';

import type { CSSProperties, InputHTMLAttributes } from 'react';

type RangeInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'value' | 'min' | 'max'
> & {
  value: number;
  min: number;
  max: number;
};

/** 与雨城通（yct-v2）同款滑杆：把填充进度写成 CSS 变量，由轨道渐变消费。 */
export function RangeInput({ value, min, max, style, ...props }: RangeInputProps) {
  const progress = max > min ? Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100)) : 0;

  return (
    <input
      {...props}
      type="range"
      min={min}
      max={max}
      value={value}
      style={{ ...style, '--ldpass-range-progress': `${progress}%` } as CSSProperties}
    />
  );
}
