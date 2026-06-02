// ════════════════════════════════════════════════════════════════════
//  Expert Réno — Notification email à chaque nouvelle demande
//
//  Cette « Edge Function » Supabase est appelée automatiquement quand une
//  nouvelle ligne est ajoutée dans la table « leads » (voir le guide
//  CRM-SUPABASE.md, étape « Notifications email »). Elle envoie un email
//  via Resend (https://resend.com — offre gratuite suffisante).
//
//  Secrets à définir (Dashboard Supabase → Edge Functions → notify-lead → Secrets,
//  ou : supabase secrets set ...):
//    RESEND_API_KEY  = votre clé API Resend (re_...)
//    NOTIFY_TO       = l'email qui reçoit les alertes (ex. contact@expertreno.fr)
//    NOTIFY_FROM     = expéditeur vérifié (ex. "Expert Réno <onboarding@resend.dev>")
// ════════════════════════════════════════════════════════════════════

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const NOTIFY_TO = Deno.env.get("NOTIFY_TO") ?? "";
const NOTIFY_FROM = Deno.env.get("NOTIFY_FROM") ?? "Expert Réno <onboarding@resend.dev>";

const STATUTS: Record<string, string> = {
  nouveau: "Nouveau",
  contacte: "Contacté",
  devis_envoye: "Devis envoyé",
  gagne: "Gagné",
  perdu: "Perdu",
};

Deno.serve(async (req) => {
  try {
    const payload = await req.json();
    // Supabase envoie { type, table, record, ... } ; on accepte aussi un lead direct.
    const lead = payload.record ?? payload;

    if (!RESEND_API_KEY || !NOTIFY_TO) {
      console.error("Configuration manquante : RESEND_API_KEY ou NOTIFY_TO");
      return new Response("Configuration incomplète", { status: 200 });
    }

    const nom = [lead.prenom, lead.nom].filter(Boolean).join(" ") || "(sans nom)";
    const html = `
      <h2>🔔 Nouvelle demande sur le site Expert Réno</h2>
      <table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px">
        <tr><td style="padding:4px 12px 4px 0"><b>Nom</b></td><td>${esc(nom)}</td></tr>
        <tr><td style="padding:4px 12px 4px 0"><b>Email</b></td><td>${esc(lead.email)}</td></tr>
        <tr><td style="padding:4px 12px 4px 0"><b>Téléphone</b></td><td>${esc(lead.telephone)}</td></tr>
        <tr><td style="padding:4px 12px 4px 0"><b>Type de projet</b></td><td>${esc(lead.type_projet)}</td></tr>
        <tr><td style="padding:4px 12px 4px 0"><b>Budget</b></td><td>${esc(lead.budget)}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;vertical-align:top"><b>Message</b></td><td>${esc(lead.message).replace(/\n/g, "<br>")}</td></tr>
      </table>
      <p style="color:#666;font-size:12px">Statut initial : ${STATUTS[lead.statut] ?? lead.statut ?? "Nouveau"} — Connectez-vous au tableau de bord pour la traiter.</p>
    `;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: NOTIFY_FROM,
        to: [NOTIFY_TO],
        reply_to: lead.email || undefined,
        subject: `Nouvelle demande — ${nom}`,
        html,
      }),
    });

    if (!res.ok) {
      console.error("Erreur Resend:", res.status, await res.text());
      return new Response("Erreur envoi email", { status: 200 });
    }
    return new Response("OK", { status: 200 });
  } catch (e) {
    console.error("Erreur fonction notify-lead:", e);
    return new Response("Erreur", { status: 200 });
  }
});

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
