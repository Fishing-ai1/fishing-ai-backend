// src/server.ts — Stable Backend + New Endpoints (matches your latest frontend)
// - Fastify + CORS + multipart + static media
// - Postgres if DATABASE_URL is set; otherwise in-memory (so UI always works)
// - Endpoints: /health, /catches, /catches/with-photo, /queue/sync,
//              /predict/now, /env/fetch/auto, /patterns, /undersized,
//              /places/:kind, /stats/summary, /export/catches.csv

import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import fs from "node:fs";
import { config as dotenv } from "dotenv";
import { Pool } from "pg";

dotenv();

const PORT = Number(process.env.PORT || 4000);
const HOST = process.env.HOST || "127.0.0.1";
const DATABASE_URL = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || "";

const UPLOAD_DIR = path.join(process.cwd(), "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = Fastify({ logger: false });

// Plugins
app.register(cors, { origin: true });
app.register(multipart, { attachFieldsToBody: true, limits: { fileSize: 15 * 1024 * 1024 } });
app.register(fastifyStatic, { root: UPLOAD_DIR, prefix: "/media/" });

// ---- DB or In-Memory --------------------------------------------------------
const db = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL, max: 5 }) : null;

async function q(sql: string, params?: any[]) {
  if (!db) throw new Error("No DATABASE_URL configured");
  const r = await db.query(sql, params);
  return r.rows;
}

async function ensureSchema() {
  if (!db) return;
  await db.query(`
    create table if not exists public.catches (
      id bigserial primary key,
      user_email text,
      species text not null,
      weight_kg numeric,
      length_cm numeric,
      lat double precision not null,
      lng double precision not null,
      notes text,
      photo_url text,
      created_at timestamptz default now()
    );
    create index if not exists idx_catches_created on public.catches (created_at desc);
    create index if not exists idx_catches_loc on public.catches (lat, lng);

    create table if not exists public.env_ticks (
      id bigserial primary key,
      lat double precision,
      lng double precision,
      wind_kts numeric,
      sst_c numeric,
      pressure_hpa numeric,
      payload jsonb,
      created_at timestamptz default now()
    );
    create index if not exists idx_env_ticks_created on public.env_ticks (created_at desc);
  `);
}

// Fallback in-memory store if no DB
type CatchRow = {
  id: number;
  user_email?: string | null;
  species: string;
  weight_kg?: number | null;
  length_cm?: number | null;
  lat: number;
  lng: number;
  notes?: string | null;
  photo_url?: string | null;
  created_at: string;
};
const mem: { catches: CatchRow[]; nextId: number } = { catches: [], nextId: 1 };

// Size rules (toy)
const SIZE_MIN_CM: Record<string, number> = { Snapper: 35, Flathead: 40 };

// Helpers
function haversineKm(a:{lat:number,lng:number}, b:{lat:number,lng:number}) {
  const R=6371, toRad=(x:number)=>x*Math.PI/180;
  const dLat=toRad(b.lat-a.lat), dLng=toRad(b.lng-a.lng);
  const s1=Math.sin(dLat/2), s2=Math.sin(dLng/2);
  const A=s1*s1+Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*s2*s2;
  return 2*R*Math.asin(Math.min(1,Math.sqrt(A)));
}
function ok<T>(reply:any, body:T){ reply.send(body); }
function err(reply:any, e:any){ reply.code(500).send({ success:false, error: e?.message || String(e) }); }

async function saveUploadedFile(file: any): Promise<string> {
  const original = file?.filename || `photo_${Date.now()}.jpg`;
  const safe = original.replace(/[^\w.\-]/g, "_");
  const name = `${Date.now()}_${Math.random().toString(36).slice(2,8)}_${safe}`;
  const full = path.join(UPLOAD_DIR, name);
  const buf: Buffer | undefined = file?.data;
  if (!buf) throw new Error("no file data");
  fs.writeFileSync(full, buf);
  return `/media/${name}`;
}

// ---- Routes -----------------------------------------------------------------
app.get("/health", async (_req, reply) => {
  ok(reply, { success:true, ok:true, db: !!db, uploads:true, ai:false, uptime: process.uptime() });
});

// Catches (list)
app.get("/catches", async (_req, reply) => {
  try {
    if (db) {
      const rows = await q(`select * from public.catches order by created_at desc limit 200`);
      return ok(reply, rows);
    } else {
      const rows = [...mem.catches].sort((a,b)=>+new Date(b.created_at)-+new Date(a.created_at)).slice(0,200);
      return ok(reply, rows);
    }
  } catch(e){ err(reply,e); }
});

// Catches (insert JSON)
app.post("/catches", async (req:any, reply) => {
  try {
    const b = req.body || {};
    const species = String(b.species||"").trim();
    if (!species) return reply.code(400).send({ success:false, error:"species required" });
    const lat = b.lat!=null ? Number(b.lat) : null;
    const lng = b.lng!=null ? Number(b.lng) : null;
    if (lat==null || lng==null) return reply.code(400).send({ success:false, error:"lat/lng required" });

    if (db) {
      const rows = await q(
        `insert into public.catches (user_email,species,weight_kg,length_cm,lat,lng,notes,photo_url,created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
        [
          b.user_email||null, species,
          b.weight_kg!=null?Number(b.weight_kg):null,
          b.length_cm!=null?Number(b.length_cm):null,
          lat, lng, b.notes||null, b.photo_url||null,
          b.created_at? String(b.created_at) : new Date().toISOString()
        ]
      );
      return ok(reply, { success:true, id: rows[0]?.id });
    } else {
      const row: CatchRow = {
        id: mem.nextId++,
        user_email: b.user_email||null,
        species,
        weight_kg: b.weight_kg!=null?Number(b.weight_kg):null,
        length_cm: b.length_cm!=null?Number(b.length_cm):null,
        lat, lng,
        notes: b.notes||null,
        photo_url: b.photo_url||null,
        created_at: b.created_at? String(b.created_at): new Date().toISOString()
      };
      mem.catches.push(row);
      return ok(reply, { success:true, id: row.id });
    }
  } catch(e){ err(reply,e); }
});

// Catches with photo (multipart)
app.post("/catches/with-photo", async (req:any, reply) => {
  try {
    const b = req.body || {};
    const species = String(b.species||"").trim();
    if (!species) return reply.code(400).send({ success:false, error:"species required" });
    const lat = b.lat!=null ? Number(b.lat) : null;
    const lng = b.lng!=null ? Number(b.lng) : null;
    if (lat==null || lng==null) return reply.code(400).send({ success:false, error:"lat/lng required" });

    let photo_url: string | null = null;
    if (b.photo) photo_url = await saveUploadedFile(b.photo);

    if (db) {
      const rows = await q(
        `insert into public.catches (user_email,species,weight_kg,length_cm,lat,lng,notes,photo_url,created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
        [
          b.user_email||null, species,
          b.weight_kg!=null?Number(b.weight_kg):null,
          b.length_cm!=null?Number(b.length_cm):null,
          lat, lng, b.notes||null, photo_url,
          b.created_at? String(b.created_at) : new Date().toISOString()
        ]
      );
      return ok(reply, { success:true, id: rows[0]?.id, photo_url });
    } else {
      const row: CatchRow = {
        id: mem.nextId++,
        user_email: b.user_email||null,
        species,
        weight_kg: b.weight_kg!=null?Number(b.weight_kg):null,
        length_cm: b.length_cm!=null?Number(b.length_cm):null,
        lat, lng,
        notes: b.notes||null,
        photo_url,
        created_at: b.created_at? String(b.created_at): new Date().toISOString()
      };
      mem.catches.push(row);
      return ok(reply, { success:true, id: row.id, photo_url });
    }
  } catch(e){ err(reply,e); }
});

// Queue sync
app.post("/queue/sync", async (req:any, reply) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    let inserted = 0;
    for (const b of items) {
      if (!b?.species || b.lat==null || b.lng==null) continue;
      if (db) {
        await q(
          `insert into public.catches (user_email,species,weight_kg,length_cm,lat,lng,notes,photo_url,created_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            b.user_email||null, String(b.species),
            b.weight_kg!=null?Number(b.weight_kg):null,
            b.length_cm!=null?Number(b.length_cm):null,
            Number(b.lat), Number(b.lng), b.notes||null, b.photo_url||null,
            b.created_at? String(b.created_at): new Date().toISOString()
          ]
        );
      } else {
        mem.catches.push({
          id: mem.nextId++,
          user_email: b.user_email||null,
          species: String(b.species),
          weight_kg: b.weight_kg!=null?Number(b.weight_kg):null,
          length_cm: b.length_cm!=null?Number(b.length_cm):null,
          lat: Number(b.lat),
          lng: Number(b.lng),
          notes: b.notes||null,
          photo_url: b.photo_url||null,
          created_at: b.created_at? String(b.created_at): new Date().toISOString()
        });
      }
      inserted++;
    }
    ok(reply, { success:true, inserted });
  } catch(e){ err(reply,e); }
});

// Predict (grid from real catches)
app.get("/predict/now", async (req:any, reply) => {
  try {
    const center = { lat: Number(req.query?.lat||-27.48), lng: Number(req.query?.lng||153.12) };
    const radius_km = Number(req.query?.radius_km||5);
    const species = req.query?.species ? String(req.query.species).trim().toLowerCase() : null;

    const rows: CatchRow[] = db
      ? await q(`select * from public.catches where created_at > now() - interval '18 months'`)
      : mem.catches;

    const within = rows.filter(c => {
      if (species && (c.species||"").toLowerCase() !== species) return false;
      return haversineKm(center, { lat: Number(c.lat), lng: Number(c.lng) }) <= radius_km;
    });

    const cellSize = 0.01;
    const map = new Map<string,{lat:number,lng:number,hits:number,undersized:number}>();
    for (const c of within) {
      const key = `${Math.round(c.lat/cellSize)},${Math.round(c.lng/cellSize)}`;
      if (!map.has(key)) map.set(key, { lat:c.lat, lng:c.lng, hits:0, undersized:0 });
      const cell = map.get(key)!;
      cell.hits++;
      const min = SIZE_MIN_CM[c.species||""] || 0;
      if (min && c.length_cm!=null && Number(c.length_cm) < min) cell.undersized++;
    }
    const cells = [...map.values()]
      .map(x => ({ ...x, score: Number((x.hits - x.undersized*0.6).toFixed(2)), note: x.undersized? "pressure on juveniles":"ok" }))
      .sort((a,b)=>b.score-a.score);

    ok(reply, { success:true, center, radius_km, species, cells });
  } catch(e){ err(reply,e); }
});

// Patterns (toy)
app.get("/patterns", async (_req, reply) => {
  try {
    ok(reply, { success:true, patterns: [] });
  } catch(e){ err(reply,e); }
});

// Places (friendlier stub)
app.get("/places/:kind", async (req:any, reply) => {
  const kind = String(req.params?.kind||"");
  const demo = [
    { name:"Manly Boat Harbour", address:"Manly, QLD", type:"ramps" },
    { name:"Cleveland Point", address:"Cleveland, QLD", type:"fuel" },
    { name:"Port of Brisbane Ramp", address:"Pinkenba QLD", type:"ramps" },
  ];
  const filtered = demo.filter(x => !kind || x.type === kind);
  ok(reply, { success:true, provider:"demo", results: filtered });
});

// Undersized (quick stats)
app.get("/undersized", async (req:any, reply) => {
  try {
    const species = req.query?.species ? String(req.query.species).trim().toLowerCase() : null;
    const rows: CatchRow[] = db ? await q(`select * from public.catches where length_cm is not null`) : mem.catches.filter(x=>x.length_cm!=null);
    const filtered = rows.filter(x => !species || (x.species||"").toLowerCase()===species);
    let total=0, under=0;
    for (const r of filtered) {
      total++;
      const min = SIZE_MIN_CM[r.species||""] || 0;
      if (min && (r.length_cm!=null) && Number(r.length_cm) < min) under++;
    }
    ok(reply, { success:true, total, undersized:under, rate: total? Number(((under/total)*100).toFixed(1)) : 0 });
  } catch(e){ err(reply,e); }
});

// Env fetch (stub; can save)
app.get("/env/fetch/auto", async (req:any, reply) => {
  try {
    const lat = Number(req.query?.lat||0), lng = Number(req.query?.lng||0);
    const save = String(req.query?.save||"0")==="1";
    // stub values; wire real data later
    const obs:any = { wind_kts: 12 + Math.round(Math.random()*8), sst_c: 23 + Math.random()*3, pressure_hpa: 1012 + Math.random()*4 };
    if (db && save) {
      await q(
        `insert into public.env_ticks (lat,lng,wind_kts,sst_c,pressure_hpa,payload) values ($1,$2,$3,$4,$5,$6)`,
        [lat,lng,obs.wind_kts,obs.sst_c,obs.pressure_hpa, JSON.stringify({source:"stub"})]
      );
    }
    ok(reply, { success:true, obs });
  } catch(e){ err(reply,e); }
});

// ---- Stats helpers / endpoints ---------------------------------------------
function round(val:number, places:number){ const p = Math.pow(10,places); return Math.round((val||0)*p)/p; }

function computeSummary(rows: CatchRow[]){
  const speciesCounts: Record<string, number> = {};
  let lenSum=0, lenN=0, wgtSum=0, wgtN=0;
  const trend: { t:number; v:number }[] = [];
  const zones: Record<string, number> = {};

  for (const c of rows) {
    if (c.species) speciesCounts[c.species] = (speciesCounts[c.species]||0)+1;
    if (c.length_cm!=null){ lenSum += Number(c.length_cm)||0; lenN++; }
    if (c.weight_kg!=null){ wgtSum += Number(c.weight_kg)||0; wgtN++; }
    if (c.created_at){ trend.push({ t:new Date(c.created_at).getTime(), v:1 }); }
    if (c.lat!=null && c.lng!=null){
      const key = `${round(c.lat,2)},${round(c.lng,2)}`;
      zones[key]=(zones[key]||0)+1;
    }
  }
  return {
    total: rows.length,
    speciesCounts,
    avg_length_cm: lenN ? round(lenSum/lenN, 1) : null,
    avg_weight_kg: wgtN ? round(wgtSum/wgtN, 2) : null,
    trend, // client can bucket by day
    zones
  };
}

app.get("/stats/summary", async (_req, reply) => {
  try{
    const rows: CatchRow[] = db ? await q(`select * from public.catches order by created_at asc`) : [...mem.catches].sort((a,b)=>+new Date(a.created_at)-+new Date(b.created_at));
    ok(reply, { success:true, ...computeSummary(rows) });
  }catch(e){ err(reply,e); }
});

app.get("/export/catches.csv", async (_req, reply) => {
  try{
    const rows: CatchRow[] = db ? await q(`select * from public.catches order by created_at asc`) : [...mem.catches].sort((a,b)=>+new Date(a.created_at)-+new Date(b.created_at));
    const cols = ['created_at','species','weight_kg','length_cm','lat','lng','notes','user_email','id','photo_url'];
    const csv = [cols.join(',')].concat(rows.map(r=>cols.map(k=>{
      const v: any = (r as any)[k] ?? "";
      return `"${String(v).replace(/"/g,'""')}"`;
    }).join(','))).join('\n');
    reply.header("Content-Type","text/csv");
    reply.header("Content-Disposition","attachment; filename=catches.csv");
    reply.send(csv);
  }catch(e){ err(reply,e); }
});

// AI stubs (so UI never breaks)
app.post("/ai/chat/smart", async (req:any, reply) => {
  const prompt = String(req.body?.prompt||"").trim();
  ok(reply, { success:true, answer:`(Local mode) "${prompt}" — log more catches to improve predictions.`, sources:[] });
});
app.post("/ai/web/learn", async (_req, reply) => ok(reply, { success:true, learned:[], note:"web learn not wired" }));
app.post("/ai/embeddings/build", async (_req, reply) => ok(reply, { success:true, embedded:0 }));
app.post("/ai/memory/add-url", async (_req, reply) => ok(reply, { success:true, id:Date.now(), chars:0 }));
app.post("/ai/memory/learn-from-catches", async (_req, reply) => ok(reply, { success:true, added:0 }));

// Start
async function start() {
  try {
    await ensureSchema();
    await app.listen({ host: HOST, port: PORT });
    console.log(`Fishing AI backend running at http://${HOST}:${PORT}`);
  } catch (e) {
    console.error("Boot error:", e);
    process.exit(1);
  }
}
start();
