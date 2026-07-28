const isGitHubPages = process.env.GITHUB_PAGES === 'true';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  ...(isGitHubPages ? {
    output: 'export',
    basePath: '/MOE-AI',
    assetPrefix: '/MOE-AI',
    trailingSlash: true,
    images: { unoptimized: true }
  } : {})
};

export default nextConfig;
