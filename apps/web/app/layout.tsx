import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'OpenInterview AI — Prepare with purpose', description: 'Your local-first interview workspace. Resume studio, meaningful practice, coding, and user-controlled conversation notes.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en" suppressHydrationWarning><body>{children}</body></html>; }
