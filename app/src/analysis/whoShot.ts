import type { Frame, Box } from "../vision/frame";
import { cosine, embed, meanEmbedding, type EmbedInfer } from "../vision/appearance";
import type { Attribution } from "./attribution";

// Team or partner, decided at the moment of the shot: the shooter's crop in the burst frames is embedded and
// compared with the team's reference look and the partner's. This does not depend on the tracker keeping
// identities straight over the match (it swaps robots that stand side by side under the hive).

// several looks per side (a mean of many embeddings sits close to everything, so the nearest piece is compared instead)
export interface Looks { team: Float32Array[]; partner: Float32Array[] }

/** Reference looks for one match: team = identified pieces; partner = same-alliance pieces that overlap them in time. */
export function referenceLooks(robots: { id: number; embedding: Float32Array | null; path: { t: number }[] }[], teamPieces: number[], alliancePieces: number[]): Looks {
  const team = robots.filter(r => teamPieces.includes(r.id) && r.embedding);
  const span = (r: (typeof robots)[number]) => [r.path[0].t, r.path[r.path.length - 1].t] as const;
  const overlaps = (a: (typeof robots)[number], b: (typeof robots)[number]) => { const [a0, a1] = span(a), [b0, b1] = span(b); return a0 < b1 && b0 < a1; };
  const partner = robots.filter(r => alliancePieces.includes(r.id) && !teamPieces.includes(r.id) && r.embedding && team.some(t => overlaps(t, r)));
  return { team: team.map(r => r.embedding!), partner: partner.map(r => r.embedding!) };
}
const nearest = (e: Float32Array, refs: Float32Array[]) => refs.reduce((m, r) => Math.max(m, cosine(e, r)), -1);

export class ShotLooks {
  private crops = new Map<number, Float32Array[]>();   // volley index → embeddings of the shooter during its burst
  private infer: EmbedInfer;
  constructor(infer: EmbedInfer) { this.infer = infer; }
  /** Call for a few frames of a burst with the shooter's box in that frame. */
  async add(volley: number, f: Frame, box: Box) {
    const list = this.crops.get(volley) ?? [];
    if (list.length >= 4) return;
    list.push(await embed(f, box, this.infer));
    this.crops.set(volley, list);
  }
  look(volley: number): Float32Array | null { const l = this.crops.get(volley); return l?.length ? meanEmbedding(l) : null; }
}

export interface TeamCall { volley: number; who: "team" | "partner" | null; margin: number; byLook: number | null; byChain: "team" | "partner" | null }

/**
 * References in the same domain as the shot looks (crops from the bursts), which compare far better than the
 * 720p track embeddings: the team's looks = shots by its identified piece(s); the partner's = shots by pieces that
 * were on screen at the same time as the team's piece (so cannot be the team). Falls back to the track embeddings.
 */
export function burstLooks(att: Attribution[], shotLook: (i: number) => Float32Array | null, seed: number[], overlapping: number[], fallback: Looks): Looks {
  const team: Float32Array[] = [], partner: Float32Array[] = [];
  att.forEach((a, i) => {
    if (a.robot === null || a.confidence < 0.6) return;
    const e = shotLook(i); if (!e) return;
    if (seed.includes(a.robot)) team.push(e); else if (overlapping.includes(a.robot)) partner.push(e);
  });
  return { team: team.length ? team : fallback.team, partner: partner.length ? partner : fallback.partner };
}

/** Pieces of the alliance that were on screen at the same time as any seed piece. */
export function overlappingPieces(robots: { id: number; path: { t: number }[] }[], seed: number[], alliancePieces: number[]): number[] {
  const span = (r: (typeof robots)[number]) => [r.path[0].t, r.path[r.path.length - 1].t] as const;
  const S = robots.filter(r => seed.includes(r.id));
  return robots.filter(r => alliancePieces.includes(r.id) && !seed.includes(r.id) && S.some(s => { const [a0, a1] = span(s), [b0, b1] = span(r); return a0 < b1 && b0 < a1; })).map(r => r.id);
}

/**
 * Final call per volley. The chain (which robot the shooter's track piece belongs to) decides when it is sure;
 * the shooter's look at the shot breaks ties when the chain is unsure (the looks alone proved too weak to lead:
 * the 128 px embeddings of blurred robots drift with background and distance); both unsure → a weak look call.
 */
export function callVolleys(att: Attribution[], looks: Looks, shotLook: (i: number) => Float32Array | null, chain: { team: number[]; partner: number[]; unsure: number[] }, seed: number[] = []): TeamCall[] {
  return att.map((a, i) => {
    // the identified piece itself is the team by definition
    if (a.robot !== null && seed.includes(a.robot)) return { volley: i, who: "team" as const, margin: 1, byLook: null, byChain: "team" as const };
    const byChain: "team" | "partner" | null = a.robot === null ? null : chain.unsure.includes(a.robot) ? null : chain.team.includes(a.robot) ? "team" : chain.partner.includes(a.robot) ? "partner" : null;
    const e = shotLook(i);
    let byLook: number | null = null;
    if (e && looks.team.length && looks.partner.length) byLook = nearest(e, looks.team) - nearest(e, looks.partner);
    else if (e && looks.team.length) byLook = nearest(e, looks.team) - 0.8;      // no partner look: is it the team or not?
    let who: "team" | "partner" | null = null, margin = 0;
    if (byChain) { who = byChain; margin = 0.6; }
    else if (byLook !== null && Math.abs(byLook) >= 0.06) { who = byLook > 0 ? "team" : "partner"; margin = Math.min(0.45, Math.abs(byLook)); }
    else if (byLook !== null) { who = byLook > 0 ? "team" : "partner"; margin = 0.2; }
    return { volley: i, who, margin, byLook, byChain };
  });
}
