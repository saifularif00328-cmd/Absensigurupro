export default function Logo({ className = 'logo' }) {
  return (
    <svg className={className} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="lg1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#8b7bff" /><stop offset="1" stopColor="#22d3ee" /></linearGradient>
        <linearGradient id="lg2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1a2160" /><stop offset="1" stopColor="#0b1030" /></linearGradient>
      </defs>
      <rect width="64" height="64" rx="18" fill="url(#lg2)" stroke="rgba(255,255,255,.25)" />
      <path d="M32 11 14 53h9.2l3.5-9.4h10.6l3.5 9.4H50L32 11Zm0 16.2 3.4 8.6h-6.8L32 27.2Z" fill="url(#lg1)" />
      <circle cx="49" cy="15" r="5.5" fill="#34d399" stroke="#0b1030" strokeWidth="2" />
    </svg>
  );
}
