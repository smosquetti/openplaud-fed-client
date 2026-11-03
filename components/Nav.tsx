'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const items = [
  { href: '/', label: 'Pre-configured group' },
  { href: '/select', label: 'Group drop-down' },
];

export default function Nav() {
  const path = usePathname();
  return (
    <nav className="navbar border-bottom bg-white">
      <div className="container d-flex align-items-center gap-3">
        <span className="navbar-brand">OpenPlaud · customer chat</span>
        <div className="ms-auto d-flex gap-2">
          {items.map((it) => (
            <Link
              key={it.href}
              href={it.href}
              className={`nav-link px-3 ${path === it.href ? 'active fw-semibold' : 'text-body-secondary'}`}
            >
              {it.label}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}
