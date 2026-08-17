import type { NextConfig } from "next";

const defaultDevOrigins = ["127.0.0.1", "192.168.0.15"];
const configuredDevOrigins = process.env.ALLOWED_DEV_ORIGINS
  ?.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean) ?? [];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  allowedDevOrigins: [...new Set([...defaultDevOrigins, ...configuredDevOrigins])],
};

export default nextConfig;
