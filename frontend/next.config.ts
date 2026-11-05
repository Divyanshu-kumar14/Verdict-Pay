import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: false,
  // The SDK is consumed from the sibling package via a file: dependency; let
  // Next compile it together with the app instead of treating it as opaque.
  transpilePackages: ["@verdictpay/sdk"],
};

export default nextConfig;