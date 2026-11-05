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
        d="M5.4 2.4H18.6L20.4 4.2V13.2L12 21.6L3.6 13.2V4.2Z M6.17 12.73L10.3 16.85L17.83 9.33L15.77 7.27L10.3 12.75L8.23 10.67Z"
      />
    </svg>
  );
}
