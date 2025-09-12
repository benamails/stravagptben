import { NextResponse } from "next/server";

function cors() {
  return {
    "Access-Control-Allow-Origin": "https://chat.openai.com",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { headers: cors() });
}

export async function GET() {
  const url = process.env.MAKE_WEBHOOK_URL;
  if (!url) {
    return NextResponse.json(
      { ok: false, error: "MAKE_WEBHOOK_URL is not set" },
      { status: 500, headers: cors() }
    );
  }

  // (Optionnel) Si tu as mis un header d’auth côté Make
  const headers: Record<string, string> = {};
  if (process.env.MAKE_API_KEY) headers["x-make-apikey"] = process.env.MAKE_API_KEY;

  const upstream = await fetch(url, { headers, cache: "no-store" });
  const text = await upstream.text(); // on ne suppose pas le format, on relaye

  // Relais brut + même content-type si possible
  const contentType = upstream.headers.get("content-type") ?? "application/json; charset=utf-8";
  return new NextResponse(text, {
    status: upstream.status,
    headers: { ...cors(), "content-type": contentType },
  });
}
