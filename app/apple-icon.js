import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';
export const dynamic = 'force-static';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 42,
          background: 'linear-gradient(135deg, #2ee6aa, #41c8f5)',
          color: '#052033',
          fontSize: 92,
          fontWeight: 900,
          letterSpacing: -8
        }}
      >
        M
      </div>
    ),
    size
  );
}
