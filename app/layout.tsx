import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Acid Forge — browser acid instrument',
  description: 'A local-first original mono subtractive instrument for building acid basslines.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
