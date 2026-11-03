import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import 'bootstrap/dist/css/bootstrap.min.css';
import './globals.css';
import Nav from '@/components/Nav';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'OpenPlaud Customer Chat', template: '%s · OpenPlaud Customer Chat' },
  description:
    'Embeddable customer chat bubble for the OpenPlaud platform — temporary customer accounts, temporary MUC rooms, first-message handoff to operators.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} font-inter`}>
      <body>
        <Nav />
        {children}
      </body>
    </html>
  );
}
