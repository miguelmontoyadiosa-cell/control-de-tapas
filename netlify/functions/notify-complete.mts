import type { Context, Config } from "@netlify/functions";

// Fired once a tapa is fully approved by the client. Emails the complete
// record (specs + full stage history + photos as attachments) to the shop's
// notification address via Resend, so the app can drop the tapa afterward
// and the email becomes the durable archive.
//
// Requires two Netlify env vars:
//   RESEND_API_KEY  — from the Resend dashboard (Settings > API Keys)
//   NOTIFY_EMAIL_TO — destination address (defaults to controldetapas@gmail.com)
//
// Resend's shared "onboarding@resend.dev" sender can only deliver to the
// Resend account's OWN signup email unless a custom domain is verified — so
// the Resend account should be created using the same address as
// NOTIFY_EMAIL_TO for this to work without any domain setup.

function escapeHtml(s: unknown): string {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => {
    const map: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return map[c];
  });
}

function row(label: string, value: unknown): string {
  if (value === undefined || value === null || value === "" || value === false) return "";
  return `<tr><td style="padding:4px 12px 4px 0;color:#6b5a48;white-space:nowrap;vertical-align:top;">${escapeHtml(label)}</td><td style="padding:4px 0;">${escapeHtml(value)}</td></tr>`;
}

interface Comentario { autor?: string; texto?: string; fecha?: string; }
interface Foto { dataUrl?: string; nombre?: string; }
interface Etapa { label?: string; estado?: string; responsable?: string; inicio?: string; fin?: string; comentarios?: Comentario[]; fotos?: Foto[]; }
interface Tapa {
  etiqueta?: string; ambiente?: string; material?: string; materialSerial?: string; materialUbicacion?: string;
  espesor?: string; backsplash?: boolean; backsplashMedida?: string; perfil?: string; sink?: string; huecos?: number;
  fechaTemplado?: string; fechaInicioFabricacion?: string; fechaInstalacion?: string;
  instalador?: string; notas?: string; etapas?: Etapa[];
  sobranteMaterial?: string; sobranteCantidad?: string; sobranteUbicacion?: string;
  porDibujo?: boolean;
}
interface Cliente { nombre?: string; telefono?: string; direccion?: string; }

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let body: { cliente?: Cliente; tapa?: Tapa };
  try {
    body = await req.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: "invalid_json" }), { status: 400, headers: { "content-type": "application/json" } });
  }

  const apiKey = Netlify.env.get("RESEND_API_KEY");
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "not_configured", detail: "RESEND_API_KEY is not set" }), { status: 500, headers: { "content-type": "application/json" } });
  }
  const to = Netlify.env.get("NOTIFY_EMAIL_TO") || "controldetapas@gmail.com";

  const c = body.cliente || {};
  const t = body.tapa || {};
  const etapas = Array.isArray(t.etapas) ? t.etapas : [];

  let html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#2a231c;">`;
  html += `<h2 style="margin:0 0 12px;">${escapeHtml(c.nombre)} — ${escapeHtml(t.etiqueta)}</h2>`;
  html += `<table style="border-collapse:collapse;font-size:14px;">`;
  html += row("Client", c.nombre);
  html += row("Phone", c.telefono);
  html += row("Address", c.direccion);
  html += row("Room / area", t.ambiente);
  html += row("By drawing (no on-site template)", t.porDibujo ? "Yes" : "");
  html += row("Material", t.material);
  html += row("Material serial number", t.materialSerial);
  html += row("Material location (warehouse)", t.materialUbicacion);
  html += row("Thickness", t.espesor);
  html += row("Backsplash", t.backsplash ? `Yes — ${t.backsplashMedida || "no measurement on file"}` : "");
  html += row("Edge profile", t.perfil);
  html += row("Sink", t.sink);
  html += row("Faucet holes", t.huecos);
  html += row("Leftover material", t.sobranteMaterial === "si" ? `Yes — ${t.sobranteCantidad || "amount not on file"} — stored at ${t.sobranteUbicacion || "location not on file"}` : "");
  html += row("Template date", t.fechaTemplado);
  html += row("Fabrication start date", t.fechaInicioFabricacion);
  html += row("Installation date", t.fechaInstalacion);
  html += row("Installer", t.instalador);
  html += row("Notes", t.notas);
  html += `</table>`;

  html += `<h3 style="margin:22px 0 8px;">Stage history</h3>`;
  for (const e of etapas) {
    html += `<div style="margin-bottom:12px;">`;
    html += `<b>${escapeHtml(e.label)}</b> — ${escapeHtml(e.estado)}`;
    if (e.responsable) html += ` · ${escapeHtml(e.responsable)}`;
    if (e.inicio) html += ` · started ${escapeHtml(e.inicio)}`;
    if (e.fin) html += ` · finished ${escapeHtml(e.fin)}`;
    html += `</div>`;
    for (const cm of e.comentarios || []) {
      html += `<div style="margin:2px 0 2px 14px;font-size:13px;color:#5a4d3d;">💬 <i>${escapeHtml(cm.autor)}:</i> ${escapeHtml(cm.texto)}</div>`;
    }
  }
  html += `<p style="margin-top:24px;color:#8a7a66;font-size:12px;">Automatically sent by Control de Tapas when this job was marked complete. Photos are attached to this email.</p>`;
  html += `</div>`;

  const attachments: { filename: string; content: string }[] = [];
  for (const e of etapas) {
    for (const f of e.fotos || []) {
      if (!f.dataUrl) continue;
      const base64 = String(f.dataUrl).split(",")[1];
      if (!base64) continue;
      attachments.push({ filename: f.nombre || "foto.jpg", content: base64 });
    }
  }

  const resendResp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "Control de Tapas <onboarding@resend.dev>",
      to: [to],
      subject: `Job completed — ${t.etiqueta ? t.etiqueta + " — " : ""}${c.nombre || ""}`,
      html,
      attachments,
    }),
  });

  if (!resendResp.ok) {
    const detail = await resendResp.text().catch(() => "");
    return new Response(JSON.stringify({ error: "resend_failed", detail }), { status: 502, headers: { "content-type": "application/json" } });
  }

  return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
};

export const config: Config = {
  path: "/api/notify-complete",
};
