import './globals.css';

export const metadata = {
  title: 'MOE AI Pro',
  description: 'Signal command center for ranked trading opportunities',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'MOE AI', statusBarStyle: 'black-translucent' }
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#071522'
};

export default function RootLayout({ children }) {
  return <html lang="en"><body>{children}</body></html>;
}
