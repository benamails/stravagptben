import { NextRequest, NextResponse } from "next/server";

type StravaActivity = Record<string, unknown> & {
  id?: number | string;
};

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const activityId = params.id;
    if (!activityId) {
      return NextResponse.json({ ok: false, error: "missing_activity_id" }, { status: 400 });
    }

    const relayUrl = process.env.MAKE_WEBHOOK_URL_ACTIVITY;
    const relaySecret = process.env.MAKE_API_KEY;
    if (!relayUrl || !relaySecret) {
      return NextResponse.json({ ok: false, error: "missing_make_config" }, { status: 500 });
    }

    // Sécurité simple (tu peux aussi utiliser un header si tu préfères)
    const url = new URL(relayUrl);
    url.searchParams.set("activity_id", activityId);
    url.searchParams.set("secret", relaySecret);

    // Appel Make: le scénario va récupérer l’activité Strava et répondre avec le JSON
    const makeResp = await fetch(url.toString(), { method: "GET" });

    // Propage le code d'erreur Make si besoin
    if (!makeResp.ok) {
      const text = await makeResp.text().catch(() => "");
      return NextResponse.json(
        { ok: false, error: `make_failed_${makeResp.status}`, details: text.slice(0, 500) },
        { status: 502 }
      );
    }

    // On ne touche pas au JSON: on relaye tel quel
    const activity = (await makeResp.json()) as StravaActivity;
    if (!activity?.id) {
      return NextResponse.json({ ok: false, error: "invalid_activity_payload_from_make" }, { status: 502 });
    }

    return new NextResponse(JSON.stringify(activity), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  } catch (err: any) {
    console.error("[relay/activity] error:", err);
    return NextResponse.json({ ok: false, error: err?.message ?? "unknown" }, { status: 500 });
  }
}
