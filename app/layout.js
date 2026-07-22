import './globals.css';

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

export const metadata = {
  applicationName: 'MOE AI Pro',
  title: {
    default: 'MOE AI Pro',
    template: '%s · MOE AI Pro'
  },
  description: 'Mobile signal command center for ranked trading opportunities',
  manifest: `${basePath}/manifest.webmanifest`,
  icons: {
    icon: `${basePath}/icon-192.svg`,
    shortcut: `${basePath}/icon-192.svg`
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
