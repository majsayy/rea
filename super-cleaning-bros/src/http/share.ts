import { escapeHtml } from "../domain/templates.ts";
import type { Ctx } from "../app/context.ts";
import type { Job, PhotoMeta } from "../domain/types.ts";

export function shareDocument(ctx: Ctx, token: string): { status: number; html?: string; photo?: { contentType: string; bytes: Uint8Array } } {
  const job = ctx.store.findJobByShareToken(token);
  if (!job) return { status: 404 };
  return { status: 200, html: renderGallery(ctx, job) };
}

export function sharePhoto(ctx: Ctx, token: string, photoId: string): { status: number; contentType?: string; bytes?: Uint8Array } {
  const job = ctx.store.findJobByShareToken(token);
  if (!job) return { status: 404 };
  const photo = ctx.store.getPhoto(job.id, photoId);
  if (!photo || (photo.meta.kind !== "before" && photo.meta.kind !== "after")) return { status: 404 };
  return { status: 200, contentType: photo.meta.contentType, bytes: photo.bytes };
}

function renderGallery(ctx: Ctx, job: Job): string {
  const photos = ctx.store.listPhotoMeta(job.id).filter((photo) => photo.kind === "before" || photo.kind === "after");
  const before = photos.filter((photo) => photo.kind === "before");
  const after = photos.filter((photo) => photo.kind === "after");
  const token = job.shareToken ?? "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(job.title)} · Super Cleaning Bros</title>
  <style>
    body { margin: 0; font-family: "Avenir Next", "Segoe UI", sans-serif; background: #f4f7f5; color: #1c2420; }
    header { background: #10261e; color: #f7f4ef; padding: 20px; }
    main { max-width: 880px; margin: 0 auto; padding: 20px; }
    h1 { font-size: 1.4rem; margin: 0 0 6px; }
    h2 { font-size: 1rem; margin: 18px 0 8px; }
    .gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px; }
    figure { margin: 0; background: white; border-radius: 12px; overflow: hidden; }
    img { width: 100%; height: 180px; object-fit: cover; display: block; }
    figcaption { padding: 8px; font-size: 0.85rem; }
  </style>
</head>
<body>
  <header><strong>Super Cleaning Bros</strong><div>Erie, CO</div></header>
  <main>
    <h1>${escapeHtml(job.title)}</h1>
    <p>Before and after photos from your visit.</p>
    ${section("Before", before, token)}
    ${section("After", after, token)}
  </main>
</body>
</html>`;
}

function section(label: string, photos: PhotoMeta[], token: string): string {
  if (photos.length === 0) return `<h2>${label}</h2><p>No ${label.toLowerCase()} photos yet.</p>`;
  return `<h2>${label}</h2><div class="gallery">${photos
    .map(
      (photo) =>
        `<figure><img alt="${escapeHtml(label)} photo" src="/share/${encodeURIComponent(token)}/photos/${encodeURIComponent(photo.id)}" /><figcaption>${escapeHtml(label)}</figcaption></figure>`,
    )
    .join("")}</div>`;
}
