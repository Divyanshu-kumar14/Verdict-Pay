/** VerdictPay mark, inlined so it inherits currentColor. */
export function LogoMark({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden
      className={className}
      focusable="false"
    >
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M12 1.8 20.4 4.9v6.9c0 4.9-3.5 8.4-8.4 10.4-4.9-2-8.4-5.5-8.4-10.4V4.9L12 1.8Zm0 2.45L5.6 6.25v5.55c0 3.9 2.8 6.7 6.4 8.3 3.6-1.6 6.4-4.4 6.4-8.3V6.25L12 4.25Z"
      />
      <path
        fill="currentColor"
        d="M10.9 15.1l-2.75-2.75 1.3-1.3 1.45 1.45 4.65-4.65 1.3 1.3-5.95 5.95Z"
      />
    </svg>
  );
}
