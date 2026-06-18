import { expiresText, fmtMiles, quakeColor, timeAgo } from './format';
import type { PropertyDetailPayload } from './PropertyDetail';
import type { PropertyHazards } from './proximityScan';

// ── Design tokens ─────────────────────────────────────────────────────────────

const W       = 560;
const PAD     = 24;
const RADIUS  = 8;
const ROW_H   = 22;

const BG         = '#0a0e14';
const BG_CARD    = '#131920';
const BG_SECTION = '#161d26';
const BORDER     = 'rgba(255,255,255,0.08)';
const ACCENT     = '#3b9eff';
const ACCENT2    = '#1565c0';
const OK         = '#22c55e';
const WARN       = '#f97316';
const TEXT_HI    = 'rgba(255,255,255,0.90)';
const TEXT_MID   = 'rgba(255,255,255,0.55)';
const TEXT_LO    = 'rgba(255,255,255,0.30)';

// ── Canvas helpers ────────────────────────────────────────────────────────────

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function truncate(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 0 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, r = 4) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

// ── Height estimator (must match draw pass exactly) ───────────────────────────

function estimateHeight(hazards: PropertyHazards | null): number {
  let h = 0;

  // Header bar
  h += 58;

  // Property block
  h += PAD + 20 + 6 + 16 + 6 + 14 + PAD; // icon row + name + group + coords

  // Status row
  h += 14 + 16; // status + gap

  // Divider
  h += 1 + 16;

  if (!hazards) {
    h += 44 + PAD; // all-clear banner
  } else {
    // Alerts
    if (hazards.alerts.length > 0) {
      h += 13 + 6; // section title
      for (const a of hazards.alerts) {
        h += a.headline ? 52 : 34;
        h += 4;
      }
      h += 12;
    }

    // Fires
    if (hazards.fires.length > 0) {
      const shown = Math.min(hazards.fires.length, 8);
      h += 13 + 6 + shown * (ROW_H + 2) + 12;
    }

    // Quakes
    if (hazards.quakes.length > 0) {
      const shown = Math.min(hazards.quakes.length, 8);
      h += 13 + 6 + shown * (ROW_H + 2) + 12;
    }

    if (hazards.alerts.length === 0 && hazards.fires.length === 0 && hazards.quakes.length === 0) {
      h += 44 + PAD;
    }
  }

  // Footer
  h += PAD + 32;

  return Math.ceil(h);
}

// ── Main draw function ────────────────────────────────────────────────────────

function draw(
  ctx: CanvasRenderingContext2D,
  totalH: number,
  payload: PropertyDetailPayload,
  hazards: PropertyHazards | null,
  radiusMi: number,
  updatedMs: number | null,
) {
  const INNER = W - PAD * 2;
  let y = 0;

  // ── Background ──────────────────────────────────────────────────────────────
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, totalH);

  // ── Header bar ──────────────────────────────────────────────────────────────
  {
    const grd = ctx.createLinearGradient(0, 0, W, 0);
    grd.addColorStop(0, ACCENT2);
    grd.addColorStop(1, '#0d2a6e');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, W, 58);

    // Top accent stripe
    ctx.fillStyle = ACCENT;
    ctx.fillRect(0, 0, W, 2);

    // Left: title + subtitle
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.font = 'bold 15px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText('GSOC Monitor', PAD, 20);

    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillText('Property Watch Report', PAD, 40);

    // Right: date/time
    const now = new Date();
    const dateStr = now.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    const timeStr = now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '10px "SF Mono", "Courier New", monospace';
    ctx.textAlign = 'right';
    ctx.fillText(dateStr, W - PAD, 20);
    ctx.fillText(timeStr, W - PAD, 36);
  }
  y = 58;

  // ── Property block ──────────────────────────────────────────────────────────
  y += PAD;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  // Icon + name
  const iconX = PAD;
  ctx.font = '22px serif';
  ctx.fillText(payload.groupIcon, iconX, y - 2);

  const nameX = PAD + 34;
  ctx.fillStyle = TEXT_HI;
  ctx.font = 'bold 17px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.fillText(truncate(ctx, payload.name, INNER - 34), nameX, y);

  y += 22;
  ctx.fillStyle = TEXT_MID;
  ctx.font = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.fillText(truncate(ctx, payload.groupName, INNER - 34), nameX, y);

  y += 18;
  const lat = payload.lat >= 0 ? `${payload.lat.toFixed(4)}°N` : `${Math.abs(payload.lat).toFixed(4)}°S`;
  const lon = payload.lon >= 0 ? `${payload.lon.toFixed(4)}°E` : `${Math.abs(payload.lon).toFixed(4)}°W`;
  ctx.fillStyle = TEXT_LO;
  ctx.font = '10px "SF Mono", "Courier New", monospace';
  ctx.fillText(`${lat}  ${lon}`, nameX, y);

  y += 18;

  // ── Status row ──────────────────────────────────────────────────────────────
  y += PAD;
  dot(ctx, PAD + 5, y + 6, OK, 4);
  ctx.fillStyle = OK;
  ctx.font = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText(`Live · ${radiusMi} mi watch`, PAD + 14, y);
  if (updatedMs) {
    ctx.fillStyle = TEXT_LO;
    ctx.fillText(`· updated ${timeAgo(updatedMs)}`, PAD + 14 + ctx.measureText(`Live · ${radiusMi} mi watch`).width + 4, y);
  }
  y += 14;

  // ── Divider ─────────────────────────────────────────────────────────────────
  y += 14;
  ctx.strokeStyle = BORDER;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, y);
  ctx.lineTo(W - PAD, y);
  ctx.stroke();
  y += 1;
  y += 16;

  // ── All-clear ───────────────────────────────────────────────────────────────
  const noHazards = !hazards || (hazards.alerts.length === 0 && hazards.fires.length === 0 && hazards.quakes.length === 0);
  if (noHazards) {
    rr(ctx, PAD, y, INNER, 44, RADIUS);
    ctx.fillStyle = 'rgba(34,197,94,0.12)';
    ctx.fill();
    rr(ctx, PAD, y, INNER, 44, RADIUS);
    ctx.strokeStyle = 'rgba(34,197,94,0.30)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = OK;
    ctx.font = 'bold 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText(`✓  No active hazards within ${radiusMi} mi`, W / 2, y + 22);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    y += 44 + PAD;
  } else {
    // ── Alerts ────────────────────────────────────────────────────────────────
    if (hazards!.alerts.length > 0) {
      ctx.fillStyle = TEXT_LO;
      ctx.font = 'bold 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.letterSpacing = '0.1em';
      ctx.fillText(`ACTIVE ALERTS (${hazards!.alerts.length})`, PAD, y);
      ctx.letterSpacing = '0em';
      y += 13 + 6;

      for (const a of hazards!.alerts) {
        const rowH = a.headline ? 52 : 34;
        // Card background
        rr(ctx, PAD, y, INNER, rowH, 6);
        ctx.fillStyle = BG_CARD;
        ctx.fill();
        rr(ctx, PAD, y, INNER, rowH, 6);
        ctx.strokeStyle = BORDER;
        ctx.lineWidth = 1;
        ctx.stroke();

        // Left color bar
        ctx.fillStyle = a.colorHex;
        ctx.beginPath();
        ctx.moveTo(PAD, y + 6);
        ctx.arcTo(PAD, y, PAD + 6, y, 6);
        ctx.lineTo(PAD + 3, y);
        ctx.lineTo(PAD + 3, y + rowH);
        ctx.lineTo(PAD, y + rowH - 6);
        ctx.arcTo(PAD, y + rowH, PAD + 6, y + rowH, 6);
        ctx.closePath();
        ctx.fill();

        const textX = PAD + 12;
        const textW = INNER - 12 - 80;
        ctx.fillStyle = a.colorHex;
        ctx.font = 'bold 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        ctx.textBaseline = 'top';
        ctx.fillText(truncate(ctx, a.event, textW), textX, y + 10);

        // Expires
        const left = expiresText(a.expires);
        if (left) {
          ctx.fillStyle = TEXT_LO;
          ctx.font = '10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
          ctx.textAlign = 'right';
          ctx.fillText(left, W - PAD - 8, y + 11);
          ctx.textAlign = 'left';
        }

        if (a.headline) {
          ctx.fillStyle = TEXT_MID;
          ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
          ctx.fillText(truncate(ctx, a.headline, INNER - 16), textX, y + 28);
        }

        y += rowH + 4;
      }
      y += 12;
    }

    // ── Fires ────────────────────────────────────────────────────────────────
    if (hazards!.fires.length > 0) {
      ctx.fillStyle = TEXT_LO;
      ctx.font = 'bold 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.letterSpacing = '0.1em';
      ctx.fillText(`NEARBY FIRES (${hazards!.fires.length})`, PAD, y);
      ctx.letterSpacing = '0em';
      y += 13 + 6;

      const shown = hazards!.fires.slice(0, 8);
      // Container card
      rr(ctx, PAD, y, INNER, shown.length * (ROW_H + 2) - 2, 6);
      ctx.fillStyle = BG_SECTION;
      ctx.fill();
      rr(ctx, PAD, y, INNER, shown.length * (ROW_H + 2) - 2, 6);
      ctx.strokeStyle = BORDER;
      ctx.lineWidth = 1;
      ctx.stroke();

      for (let i = 0; i < shown.length; i++) {
        const f = shown[i];
        const fy = y + i * (ROW_H + 2) + 4;
        ctx.font = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        ctx.fillStyle = TEXT_MID;
        ctx.textBaseline = 'top';
        ctx.fillText('🔥', PAD + 8, fy - 1);
        ctx.fillStyle = TEXT_MID;
        ctx.fillText(`${fmtMiles(f.distanceMi)} mi away`, PAD + 28, fy);
        if (f.frp != null) {
          ctx.fillStyle = TEXT_LO;
          ctx.textAlign = 'right';
          ctx.fillText(`${f.frp.toFixed(0)} MW`, W - PAD - 8, fy);
          ctx.textAlign = 'left';
        }
      }

      if (hazards!.fires.length > 8) {
        const extra = hazards!.fires.length - 8;
        y += shown.length * (ROW_H + 2) - 2;
        ctx.fillStyle = TEXT_LO;
        ctx.font = '10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        ctx.fillText(`+${extra} more`, PAD, y + 4);
        y += 14;
      } else {
        y += shown.length * (ROW_H + 2) - 2;
      }
      y += 12;
    }

    // ── Quakes ────────────────────────────────────────────────────────────────
    if (hazards!.quakes.length > 0) {
      ctx.fillStyle = TEXT_LO;
      ctx.font = 'bold 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.letterSpacing = '0.1em';
      ctx.fillText(`RECENT EARTHQUAKES (${hazards!.quakes.length})`, PAD, y);
      ctx.letterSpacing = '0em';
      y += 13 + 6;

      const shown = hazards!.quakes.slice(0, 8);
      rr(ctx, PAD, y, INNER, shown.length * (ROW_H + 2) - 2, 6);
      ctx.fillStyle = BG_SECTION;
      ctx.fill();
      rr(ctx, PAD, y, INNER, shown.length * (ROW_H + 2) - 2, 6);
      ctx.strokeStyle = BORDER;
      ctx.lineWidth = 1;
      ctx.stroke();

      for (let i = 0; i < shown.length; i++) {
        const q = shown[i];
        const qy = y + i * (ROW_H + 2) + 4;
        ctx.textBaseline = 'top';

        // Magnitude badge
        ctx.fillStyle = quakeColor(q.mag);
        ctx.font = 'bold 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        ctx.fillText(`M${q.mag.toFixed(1)}`, PAD + 8, qy);

        ctx.fillStyle = TEXT_MID;
        ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        const placeX = PAD + 8 + ctx.measureText(`M${q.mag.toFixed(1)}`).width + 8;
        const placeW = INNER - 16 - (placeX - PAD) - 90;
        ctx.fillText(truncate(ctx, q.place || 'unknown', placeW), placeX, qy + 1);

        ctx.fillStyle = TEXT_LO;
        ctx.textAlign = 'right';
        ctx.font = '10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        ctx.fillText(`${fmtMiles(q.distanceMi)} mi · ${timeAgo(q.time)}`, W - PAD - 8, qy + 1);
        ctx.textAlign = 'left';
      }

      if (hazards!.quakes.length > 8) {
        const extra = hazards!.quakes.length - 8;
        y += shown.length * (ROW_H + 2) - 2;
        ctx.fillStyle = TEXT_LO;
        ctx.font = '10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        ctx.fillText(`+${extra} more`, PAD, y + 4);
        y += 14;
      } else {
        y += shown.length * (ROW_H + 2) - 2;
      }
      y += 12;
    }
  }

  // ── Footer ──────────────────────────────────────────────────────────────────
  y = totalH - 32;
  ctx.strokeStyle = BORDER;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, y);
  ctx.lineTo(W - PAD, y);
  ctx.stroke();
  y += 10;

  ctx.fillStyle = TEXT_LO;
  ctx.font = '10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText('Generated by GSOC Monitor · Property Watch', PAD, y);
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillText(`${radiusMi} mi radius`, W - PAD, y);
}

// ── Public API ────────────────────────────────────────────────────────────────

export function downloadPropertyReport(
  payload: PropertyDetailPayload,
  hazards: PropertyHazards | null,
  radiusMi: number,
  updatedMs: number | null,
) {
  const totalH = estimateHeight(hazards);

  const scale = 2; // retina 2×
  const canvas = document.createElement('canvas');
  canvas.width = W * scale;
  canvas.height = totalH * scale;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(scale, scale);

  draw(ctx, totalH, payload, hazards, radiusMi, updatedMs);

  const slug = payload.name.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
  const date = new Date().toISOString().slice(0, 10);
  const link = document.createElement('a');
  link.download = `${slug}_watch_${date}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
}
