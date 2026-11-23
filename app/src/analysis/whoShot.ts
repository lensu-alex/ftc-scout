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
 * Final call per volley. Looks decide when the shooter resembles one reference clearly more than the other;
 * otherwise the chain (which robot its track piece was placed with) decides; both unsure → null.
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
    if (byLook !== null && Math.abs(byLook) >= 0.04) { who = byLook > 0 ? "team" : "partner"; margin = Math.min(1, Math.abs(byLook) / 0.12); }
    else if (byChain) { who = byChain; margin = 0.5; }
    else if (byLook !== null) { who = byLook > 0 ? "team" : "partner"; margin = 0.25; }
    return { volley: i, who, margin, byLook, byChain };
  });
}
