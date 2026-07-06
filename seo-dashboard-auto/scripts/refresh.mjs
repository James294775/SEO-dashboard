/**
 * Refreshes data.js for the TNTS Organic Performance Board.
 * Pulls live data from the Semrush Analytics API (v3 + v1 backlinks).
 * Requires: Node 20+, env var SEMRUSH_API_KEY.
 * Usage: node scripts/refresh.mjs
 */

const KEY = process.env.SEMRUSH_API_KEY;
if (!KEY) { console.error("SEMRUSH_API_KEY is not set"); process.exit(1); }

const DOMAIN = "thenamethatsticks.com";
const DB = "uk";
const V3 = "https://api.semrush.com/";
const V1 = "https://api.semrush.com/analytics/v1/";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const label = (y, m) => `${MONTHS[m]} ${String(y).slice(2)}`;
const path = (u) => { try { return new URL(u).pathname; } catch { return u; } };
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

async function csv(base, params) {
  const qs = new URLSearchParams({ key: KEY, ...params });
  const res = await fetch(base + "?" + qs);
  const text = (await res.text()).trim();
  if (!res.ok || text.startsWith("ERROR")) {
    // ERROR 50 = nothing found: legitimate empty result, not a failure
    if (text.startsWith("ERROR 50")) return [];
    throw new Error(`Semrush request failed (${params.type}): ${text.slice(0, 200)}`);
  }
  const lines = text.split("\n").filter(Boolean);
  return lines.slice(1).map((l) => l.split(";").map((c) => c.replace(/^"|"$/g, "")));
}

/* ---------- pulls ---------- */

// Current overview snapshot
const rank = await csv(V3, { type: "domain_rank", domain: DOMAIN, database: DB, export_columns: "Or,Ot" });
const [kwNow, trNow] = rank[0].map(Number);

// 24 months of organic history (newest first from API)
const hist = await csv(V3, { type: "domain_rank_history", domain: DOMAIN, database: DB, display_limit: 24, export_columns: "Or,Ot,Dt" });
const organicHistory = hist.reverse().map(([or, ot, dt]) => [label(+dt.slice(0, 4), +dt.slice(4, 6) - 1), +or, +ot]);

// Top keywords by traffic share
const top = await csv(V3, { type: "domain_organic", domain: DOMAIN, database: DB, display_limit: 17, display_sort: "tr_desc", export_columns: "Ph,Po,Pp,Nq,Tr,Ur" });
const topKeywords = top.map(([ph, po, pp, nq, tr, ur]) => [ph, +po, (+pp ? +pp - +po : 0), +nq, +tr, path(ur)]);

// Movements (month on month)
const q = (positions) => csv(V3, { type: "domain_organic", domain: DOMAIN, database: DB, display_limit: 8, display_positions: positions, display_sort: "nq_desc", export_columns: "Ph,Po,Pp,Nq,Ur" });
const [newKw, riseKw, lostKw, fallKw] = await Promise.all([q("new"), q("rise"), q("lost"), q("fall")]);

const gained = [
  ...newKw.map(([ph, po, , nq, ur]) => ({ kw: ph, pos: +po, was: "\u2013", vol: +nq, url: path(ur) })),
  ...riseKw.map(([ph, po, pp, nq, ur]) => ({ kw: ph, pos: +po, was: +pp, vol: +nq, url: path(ur) })),
].sort((a, b) => b.vol - a.vol).slice(0, 8);

const lost = [
  ...lostKw.map(([ph, , pp, nq, ur]) => ({ kw: ph, pos: "out", was: +pp, vol: +nq, url: path(ur) })),
  ...fallKw.map(([ph, po, pp, nq, ur]) => ({ kw: ph, pos: +po, was: +pp, vol: +nq, url: path(ur) })),
].sort((a, b) => b.vol - a.vol).slice(0, 8);

// Top pages
const pagesRaw = await csv(V3, { type: "domain_organic_unique", domain: DOMAIN, database: DB, display_limit: 11 });
const pages = pagesRaw.map(([ur, pc, tg, tr]) => [path(ur) === "/" ? "/ (homepage)" : path(ur), +pc, +tg, +tr]);

// Backlink profile
const bo = await csv(V1, { type: "backlinks_overview", target: DOMAIN, target_type: "root_domain", export_columns: "total,domains_num,ips_num,follows_num,nofollows_num,score,trust_score" });
const [blTotal, rdNum, ipsNum, follows, nofollows, ascore, trust] = bo[0].map(Number);

const bh = await csv(V1, { type: "backlinks_historical", target: DOMAIN, target_type: "root_domain", display_limit: 25, export_columns: "date,backlinks_num,domains_num" });
const linkHistory = bh.reverse().map(([ts, bl, dm]) => {
  const d = new Date(+ts * 1000);
  return [label(d.getUTCFullYear(), d.getUTCMonth()), +bl, +dm];
});

const refs = await csv(V1, { type: "backlinks_refdomains", target: DOMAIN, target_type: "root_domain", display_limit: 12, display_sort: "domain_ascore_desc", export_columns: "domain,domain_ascore,backlinks_num" });
const refdomains = refs.map(([dm, as, bl]) => [dm, +as, +bl]);

/* ---------- rule-based recovery tasks ---------- */

const tasks = [];
const fmtV = (n) => n.toLocaleString("en-GB");

// Lost keywords worth chasing
for (const k of lost.filter((k) => k.pos === "out" && k.vol >= 200).slice(0, 3)) {
  tasks.push({
    id: "t-lost-" + slug(k.kw), p: k.vol >= 400 ? "high" : "med",
    title: `Recover '${k.kw}' (dropped out of top 100)`,
    body: `Was ranking at position ${k.was} with ${fmtV(k.vol)} searches/mo, now out of the top 100. Check ${k.url} is live, indexable and in stock, then refresh the on-page copy and add 2 to 3 internal links using this keyword as anchor.`,
    chips: [`${fmtV(k.vol)}/mo`, `was p${k.was}`, k.url.split("/").filter(Boolean).pop() || "homepage"],
  });
}

// New arrivals close to page 1
for (const k of gained.filter((k) => k.was === "\u2013" && k.pos <= 35 && k.vol >= 100).slice(0, 3)) {
  const nearP1 = k.pos <= 15;
  tasks.push({
    id: "t-push-" + slug(k.kw), p: nearP1 ? "high" : (k.vol >= 500 ? "med" : "low"),
    title: `Push '${k.kw}' from p${k.pos} to page 1`,
    body: `New entry at position ${k.pos} with ${fmtV(k.vol)} searches/mo. Work the exact phrase into the H1 area and intro of ${k.url}, and point internal links at it with that anchor.${nearP1 ? " One spot shy of meaningful traffic, quick win." : ""}`,
    chips: [`${fmtV(k.vol)}/mo`, `p${k.pos} new`, k.url.split("/").filter(Boolean).pop() || "homepage"],
  });
}

// Slipping keywords still in top 100
for (const k of lost.filter((k) => k.pos !== "out" && k.vol >= 100).slice(0, 2)) {
  tasks.push({
    id: "t-slip-" + slug(k.kw), p: "low",
    title: `Arrest the slide on '${k.kw}' (p${k.was} to p${k.pos})`,
    body: `Slipped from position ${k.was} to ${k.pos} (${fmtV(k.vol)}/mo). Freshen the copy on ${k.url} and check nothing structural changed on the page.`,
    chips: [`${fmtV(k.vol)}/mo`, `p${k.was} \u2192 p${k.pos}`],
  });
}

// Link profile trend task
const rdLast = linkHistory[linkHistory.length - 1][2];
const rdPrev = linkHistory[linkHistory.length - 2][2];
tasks.push(rdLast >= rdPrev ? {
  id: "t-links-momentum", p: "med",
  title: "Keep the referring domain rebuild going",
  body: `Referring domains at ${fmtV(rdLast)}, up from ${fmtV(rdPrev)} last month, authority score ${ascore}. Next wave: trade directories, BWF and FIRA style memberships, supplier brand pages (Beardow Adams, Forgeway) and merchant stockist pages.`,
  chips: [`${fmtV(rdPrev)} \u2192 ${fmtV(rdLast)}`, `AS ${ascore}`, "directories + brands"],
} : {
  id: "t-links-decline", p: "high",
  title: "Referring domains fell this month, investigate",
  body: `Down from ${fmtV(rdPrev)} to ${fmtV(rdLast)} referring domains. Pull the lost backlinks report in Semrush, identify which domains dropped, and recover the ones worth having (broken pages, moved URLs, lapsed directory listings).`,
  chips: [`${fmtV(rdPrev)} \u2192 ${fmtV(rdLast)}`, `AS ${ascore}`, "audit lost links"],
});

const order = { high: 0, med: 1, low: 2 };
tasks.sort((a, b) => order[a.p] - order[b.p]);

/* ---------- write ---------- */

const now = new Date();
const DATA = {
  pulled: `${now.getUTCDate()} ${MONTHS[now.getUTCMonth()]} ${now.getUTCFullYear()}`,
  overview: {
    keywords: kwNow, traffic: trNow, authority: ascore,
    backlinks: blTotal, refdomains: rdNum, trustScore: trust,
    follows, nofollows, referringIPs: ipsNum,
  },
  organicHistory, linkHistory, topKeywords,
  gained: gained.map((k) => [k.kw, k.pos, k.was, k.vol]),
  lost: lost.map((k) => [k.kw, k.pos, k.was, k.vol]),
  pages, refdomains, tasks,
};

// Dashboard expects follow/nofollow percentages in the label; compute here
const fPct = Math.round((follows / (follows + nofollows)) * 100);
DATA.overview.followPct = fPct;
DATA.overview.nofollowPct = 100 - fPct;

import { writeFileSync } from "node:fs";
writeFileSync(
  new URL("../data.js", import.meta.url),
  "/* Auto-generated by scripts/refresh.mjs on " + now.toISOString() + " - do not edit by hand */\n" +
  "window.SEO_DATA = " + JSON.stringify(DATA, null, 2) + ";\n"
);
console.log(`data.js written: ${kwNow} keywords, ${trNow} traffic, ${rdNum} refdomains, AS ${ascore}, ${tasks.length} tasks`);
