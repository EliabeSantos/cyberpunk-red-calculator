import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Permite o acesso de desenvolvimento pelo IP virtual do Radmin VPN.
  allowedDevOrigins: ["26.50.194.224"],
};

export default nextConfig;
