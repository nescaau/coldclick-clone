import fs from 'node:fs';
import { api, json, readPhotoUpload } from '@/lib/http';
import { fileResponse } from '@/lib/stream';
import { avatarPhoto, replacePhoto } from '@/lib/services/avatar-service';

export const dynamic = 'force-dynamic';

type P = { id: string };

export const GET = api<P>(async (req, { params }) => {
  const p = avatarPhoto((await params).id);
  return fileResponse({ path: p.path, size: fs.statSync(p.path).size, mime: p.mime, name: 'avatar', download: false, range: req.headers.get('range') });
});

/** Foto nova no lápis do cartão. */
export const POST = api<P>(async (req, { params }) => {
  const up = await readPhotoUpload(req);
  return json(replacePhoto((await params).id, up.bytes));
});
