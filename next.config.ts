import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The RAG backend lives at api/index.py. In development it runs as a separate
  // uvicorn process; in production Vercel serves it as one Python function.
  // Vercel preserves the original request path, which is why the FastAPI routes
  // are declared with their full /api/py prefix and match in both environments.
  rewrites: async () => [
    {
      source: "/api/py/:path*",
      destination:
        process.env.NODE_ENV === "development"
          ? "http://127.0.0.1:8000/api/py/:path*"
          : "/api/",
    },
  ],
};

export default nextConfig;
