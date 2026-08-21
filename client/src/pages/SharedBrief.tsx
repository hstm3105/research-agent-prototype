import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { ArrowLeft, BookOpenText, ExternalLink, FileSearch, Loader2, Quote, ShieldCheck } from "lucide-react";
import { Streamdown } from "streamdown";
import React from "react";
import { Link, useParams } from "wouter";

type SharedSource = {
  id: string;
  title: string;
  url: string;
  publisher: string | null;
  excerpt: string | null;
  qualityScore: number;
  qualitySignalsJson: string | null;
  citationCount: number;
  retrievedAt: Date | string;
};

function formatDate(value: Date | string | null) {
  return value ? new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "Recent";
}

function qualitySignals(source: SharedSource) {
  try {
    const signals = JSON.parse(source.qualitySignalsJson || "[]");
    return Array.isArray(signals) ? signals.filter((signal): signal is string => typeof signal === "string") : [];
  } catch {
    return [];
  }
}

function EvidenceBadge({ source }: { source: SharedSource }) {
  const signals = qualitySignals(source);
  const tone = source.qualityScore >= 70 ? "bg-emerald-500/10 text-emerald-800" : source.qualityScore >= 45 ? "bg-amber-500/10 text-amber-800" : "bg-muted text-muted-foreground";
  return <span title={signals.join(" · ") || "Source metadata is limited"} className={`inline-flex rounded-full px-2 py-1 font-mono-ui text-[9px] font-medium uppercase tracking-[0.1em] ${tone}`}>{source.qualityScore >= 70 ? "High signal" : source.qualityScore >= 45 ? "Useful context" : "Limited signal"}</span>;
}

export default function SharedBrief() {
  const { token } = useParams<{ token: string }>();
  const briefQuery = trpc.research.sharedBrief.useQuery({ token: token || "missing-token" }, { enabled: Boolean(token), retry: false, refetchOnWindowFocus: false });
  const brief = briefQuery.data;
  const sources = (brief?.sources ?? []) as SharedSource[];
  const sourceMap = new Map(sources.map(source => [source.id, source]));

  if (briefQuery.isLoading) {
    return <main className="min-h-screen bg-background px-5 py-20 text-foreground"><div className="mx-auto flex max-w-2xl items-center gap-3 rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin text-primary" /> Opening the shared research brief…</div></main>;
  }

  if (!brief) {
    return <main className="grid min-h-screen place-items-center bg-background px-5 py-20 text-foreground"><section className="max-w-md rounded-[1.5rem] border border-border bg-card p-8 text-center shadow-[0_24px_70px_-42px_oklch(0.24_0.014_250/0.35)]"><ShieldCheck className="mx-auto h-7 w-7 text-primary" /><h1 className="mt-4 font-editorial text-3xl font-semibold tracking-[-0.03em]">This brief is unavailable</h1><p className="mt-3 text-sm leading-6 text-secondary-foreground">The link may have been revoked or is no longer valid. No private research content has been revealed.</p><Button asChild variant="outline" className="mt-6 rounded-xl"><Link href="/"><ArrowLeft className="mr-2 h-4 w-4" /> ResearchOS</Link></Button></section></main>;
  }

  const findings = brief.findings.map(finding => ({ ...finding, citationSourceIds: JSON.parse(finding.citationSourceIdsJson || "[]") as string[] }));
  return <main className="min-h-screen bg-[#f7f5e9] text-foreground"><header className="border-b border-border/80 bg-background/70 px-5 py-4 backdrop-blur sm:px-8"><div className="mx-auto flex max-w-6xl items-center justify-between gap-4"><Link href="/" className="flex items-center gap-2 font-editorial text-xl font-semibold tracking-[-0.03em]"><BookOpenText className="h-5 w-5 text-primary" /> ResearchOS</Link><span className="inline-flex items-center gap-2 font-mono-ui text-[10px] uppercase tracking-[0.14em] text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5 text-primary" /> Read-only shared brief</span></div></header>
    <div className="mx-auto grid max-w-6xl gap-10 px-5 py-10 sm:px-8 lg:grid-cols-[minmax(0,1fr)_300px] lg:py-14"><article className="min-w-0"><p className="font-mono-ui text-[10px] font-medium uppercase tracking-[0.16em] text-primary">Evidence brief · Shared {formatDate(brief.publishedAt)}</p><h1 className="mt-4 max-w-4xl font-editorial text-4xl font-semibold leading-tight tracking-[-0.04em] sm:text-5xl">{brief.session.title}</h1><p className="mt-5 max-w-3xl text-sm leading-6 text-secondary-foreground">{brief.session.researchGoal || brief.session.query}</p>
      {brief.session.finalOutput && <div className="mt-8 rounded-2xl border border-border bg-card p-5 text-sm leading-6 text-secondary-foreground"><Streamdown>{brief.session.finalOutput}</Streamdown></div>}
      <section className="mt-10"><div className="flex items-center gap-2"><FileSearch className="h-4 w-4 text-primary" /><p className="font-mono-ui text-[10px] font-medium uppercase tracking-[0.15em] text-primary">Cited findings</p></div><div className="mt-5 space-y-6">{findings.map((finding, index) => <article key={finding.id} className="rounded-2xl border border-border bg-card p-5"><div className="flex gap-3"><span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 font-mono-ui text-[10px] text-primary">{index + 1}</span><div><h2 className="text-base font-semibold">{finding.title}</h2><p className="mt-2 text-sm leading-6 text-secondary-foreground">{finding.claim}</p><p className="mt-3 border-l-2 border-amber-300/70 pl-3 text-xs leading-5 text-muted-foreground">{finding.evidence}</p><div className="mt-4 flex flex-wrap gap-2">{finding.citationSourceIds.map((sourceId, citationIndex) => { const source = sourceMap.get(sourceId); return source ? <a key={sourceId} href={source.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary hover:bg-primary hover:text-primary-foreground">[{citationIndex + 1}] {source.publisher || "Source"}<ExternalLink className="h-3 w-3" /></a> : null; })}</div></div></div></article>)}</div></section>
    </article>
    <aside><div className="sticky top-6 overflow-hidden rounded-[1.35rem] border border-border bg-card shadow-[0_18px_55px_-42px_oklch(0.24_0.014_250/0.7)]"><div className="flex items-center gap-2 border-b border-border px-5 py-4"><Quote className="h-4 w-4 text-primary" /><h2 className="text-sm font-semibold">References</h2><span className="ml-auto rounded-full bg-muted px-2 py-0.5 font-mono-ui text-[10px] text-muted-foreground">{sources.length}</span></div><p className="border-b border-border bg-muted/35 px-5 py-3 text-xs leading-5 text-secondary-foreground">Sources are ordered using visible metadata signals and how often the brief cites them. Scores help prioritize reading; they do not verify factual accuracy.</p><div className="max-h-[calc(100vh-230px)] space-y-3 overflow-y-auto p-3">{sources.map((source, index) => <a key={source.id} href={source.url} target="_blank" rel="noreferrer" className="group block rounded-xl p-3 hover:bg-muted"><div className="flex gap-3"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-primary/10 font-mono-ui text-[10px] text-primary">{index + 1}</span><div className="min-w-0"><p className="line-clamp-2 text-xs font-semibold leading-5 group-hover:text-primary">{source.title}</p><div className="mt-2 flex flex-wrap items-center gap-1.5"><EvidenceBadge source={source} /><span className="text-[10px] text-muted-foreground">{source.publisher || "Public source"}</span></div>{source.excerpt && <p className="mt-2 line-clamp-3 text-[11px] leading-5 text-secondary-foreground">{source.excerpt}</p>}</div></div></a>)}</div></div></aside>
    </div>
  </main>;
}
