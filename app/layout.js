import './globals.css';

export const metadata = {
  applicationName: 'MOE AI Pro',
  title: {
    default: 'MOE AI Pro',
    template: '%s · MOE AI Pro'
  },
  description: 'Mobile signal command center for ranked trading opportunities',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: '/icon-192.svg',
    shortcut: '/icon-192.svg'
  },
  appleWebApp: {
    capable: true,
    title: 'MOE AI',
    statusBarStyle: 'black-translucent'
  },
  formatDetection: {
    telephone: false
  }
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
  themeColor: '#061421',
  colorScheme: 'dark'
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
