import DashboardLayout, { type ResearchSessionNavItem } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { appendResearchActivity, applyClarificationTransition, beginClarificationResume, type ResearchActivity } from "@/lib/researchStreamState";
import { toast } from "sonner";
import { Streamdown } from "streamdown";
import {
  ArrowRight,
  Check,
  ChevronRight,
  CircleAlert,
  Clock3,
  Download,
  FileText,
  Layers3,
  Loader2,
  PanelRightOpen,
  Play,
  Quote,
  Search,
  Send,
  Sparkles,
  TableProperties,
  Timer,
} from "lucide-react";
import React, { useEffect, useMemo, useRef, useState } from "react";

type LivePlanStep = { id: string; ordinal: number; title: string; description: string; searchQuery: string; status?: string };
type LiveSource = { id: string; stepId?: string | null; title: string; url: string; publisher: string | null; excerpt: string | null; retrievedAt: Date | string };
type LiveFinding = { id: string; stepId?: string | null; ordinal?: number; title: string; claim: string; evidence: string; citationSourceIds: string[] };
type LiveClarification = { question: string };
type LiveIntentPreview = { title: string; researchGoal: string; outputFormat: string };

const exampleQueries = [
  "Compare the best approaches to decarbonizing heavy industry in the next decade.",
  "What is the evidence for and against a four-day workweek?",
  "Build a timeline of the key developments in solid-state battery research.",
];

const depthOptions = {
  quick: { label: "Quick summary", detail: "2 focused source checks" },
  standard: { label: "Standard", detail: "3 balanced research steps" },
  deep: { label: "Deep dive", detail: "5 thorough evidence steps" },
} as const;

function statusLabel(status: string | undefined) {
  return (status || "draft").replace(/_/g, " ");
}

function formatDate(value: Date | string) {
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function CitationChips({ sourceIds, sourceMap }: { sourceIds: string[]; sourceMap: Map<string, LiveSource> }) {
  return (
    <span className="inline-flex flex-wrap gap-1.5 align-middle">
      {sourceIds.map((id, index) => {
        const source = sourceMap.get(id);
        if (!source) return null;
        return (
          <a key={id} href={source.url} target="_blank" rel="noreferrer" title={source.title} className="inline-flex h-5 items-center rounded-md bg-primary/10 px-1.5 font-mono-ui text-[10px] font-medium text-primary transition-colors hover:bg-primary hover:text-primary-foreground">
            [{index + 1}]
          </a>
        );
      })}
    </span>
  );
}

function FindingsView({ outputFormat, findings, sourceMap }: { outputFormat: string; findings: LiveFinding[]; sourceMap: Map<string, LiveSource> }) {
  if (!findings.length) return null;
  if (outputFormat === "comparison") {
    return <div className="overflow-hidden rounded-2xl border border-border bg-card"><div className="grid grid-cols-[minmax(130px,0.7fr)_minmax(220px,1.3fr)_70px] border-b bg-muted/55 px-4 py-3 font-mono-ui text-[10px] uppercase tracking-[0.14em] text-muted-foreground"><span>Lens</span><span>Evidence</span><span>Sources</span></div>{findings.map(finding => <div key={finding.id} className="grid grid-cols-[minmax(130px,0.7fr)_minmax(220px,1.3fr)_70px] gap-4 border-b border-border/70 px-4 py-4 last:border-0"><span className="text-sm font-semibold">{finding.title}</span><span className="text-sm leading-6 text-secondary-foreground">{finding.claim}</span><CitationChips sourceIds={finding.citationSourceIds} sourceMap={sourceMap} /></div>)}</div>;
  }
  if (outputFormat === "timeline") {
    return <div className="space-y-0 border-l border-primary/30 pl-6">{findings.map((finding, index) => <article key={finding.id} className="relative pb-7 last:pb-0"><span className="absolute -left-[31px] top-1.5 flex h-3 w-3 rounded-full border-2 border-background bg-primary" /><span className="font-mono-ui text-[10px] uppercase tracking-[0.15em] text-primary">Development {index + 1}</span><h3 className="mt-1 text-base font-semibold">{finding.title}</h3><p className="mt-2 text-sm leading-6 text-secondary-foreground">{finding.claim} <CitationChips sourceIds={finding.citationSourceIds} sourceMap={sourceMap} /></p></article>)}</div>;
  }
  if (outputFormat === "qa") {
    return <div className="space-y-3">{findings.map(finding => <article key={finding.id} className="rounded-2xl border border-border bg-card p-5"><h3 className="flex items-start gap-2 text-sm font-semibold"><span className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 font-mono-ui text-[10px] text-primary">Q</span>{finding.title}</h3><p className="mt-3 pl-7 text-sm leading-6 text-secondary-foreground">{finding.claim} <CitationChips sourceIds={finding.citationSourceIds} sourceMap={sourceMap} /></p></article>)}</div>;
  }
  return <div className="space-y-6">{findings.map(finding => <article key={finding.id} className="group"><div className="flex gap-4"><span className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 font-mono-ui text-[10px] font-medium text-primary">{(finding.ordinal ?? 0) + 1}</span><div><h3 className="text-base font-semibold tracking-tight">{finding.title}</h3><p className="mt-2 text-sm leading-6 text-secondary-foreground">{finding.claim} <CitationChips sourceIds={finding.citationSourceIds} sourceMap={sourceMap} /></p><p className="mt-2 border-l-2 border-amber-300/70 pl-3 text-xs leading-5 text-muted-foreground">{finding.evidence}</p></div></div></article>)}</div>;
}

/**
 * All content in this page are only for example, replace with your own feature implementation
 * When building pages, remember your instructions in Frontend Workflow, Frontend Best Practices, Design Guide and Common Pitfalls
 */
export default function Home() {
  const utils = trpc.useUtils();
  const sessionsQuery = trpc.research.list.useQuery();
  const createResearch = trpc.research.create.useMutation();
  const clarifyResearch = trpc.research.clarify.useMutation();
  const createExport = trpc.research.export.useMutation();
  const [query, setQuery] = useState("");
  const [researchDepth, setResearchDepth] = useState<keyof typeof depthOptions>("standard");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [activeStepId, setActiveStepId] = useState<string | null>(null);
  const [livePlan, setLivePlan] = useState<LivePlanStep[]>([]);
  const [liveSources, setLiveSources] = useState<LiveSource[]>([]);
  const [liveFindings, setLiveFindings] = useState<LiveFinding[]>([]);
  const [liveClarification, setLiveClarification] = useState<LiveClarification | null>(null);
  const [liveIntent, setLiveIntent] = useState<LiveIntentPreview | null>(null);
  const [activityLog, setActivityLog] = useState<ResearchActivity[]>([]);
  const [streamMessage, setStreamMessage] = useState<string | null>(null);
  const streamRef = useRef<EventSource | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const detailQuery = trpc.research.get.useQuery({ sessionId: selectedSessionId ?? "pending" }, { enabled: Boolean(selectedSessionId), refetchOnWindowFocus: false });

  useEffect(() => {
    if (!selectedSessionId && sessionsQuery.data?.length) setSelectedSessionId(sessionsQuery.data[0].id);
  }, [selectedSessionId, sessionsQuery.data]);

  useEffect(() => () => streamRef.current?.close(), []);

  useEffect(() => {
    if (selectedSessionId) return;
    const timer = window.setTimeout(() => composerRef.current?.focus(), 120);
    return () => window.clearTimeout(timer);
  }, [selectedSessionId]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSelectedSessionId(null);
        window.setTimeout(() => composerRef.current?.focus(), 0);
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  const session = detailQuery.data?.session;
  const persistedSteps = (detailQuery.data?.steps ?? []) as LivePlanStep[];
  const plan = livePlan.length ? livePlan : persistedSteps;
  const allSources = useMemo(() => {
    const items = [...((detailQuery.data?.sources ?? []) as unknown as LiveSource[]), ...liveSources];
    return Array.from(new Map(items.map(item => [item.id, item])).values());
  }, [detailQuery.data?.sources, liveSources]);
  const sourceMap = useMemo(() => new Map(allSources.map(source => [source.id, source])), [allSources]);
  const allFindings = useMemo(() => {
    const persisted = (detailQuery.data?.findings ?? []).map(finding => ({ ...finding, citationSourceIds: JSON.parse(finding.citationSourceIdsJson || "[]") })) as unknown as LiveFinding[];
    return Array.from(new Map([...persisted, ...liveFindings].map(item => [item.id, item])).values()).sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0));
  }, [detailQuery.data?.findings, liveFindings]);
  const sidebarSessions: ResearchSessionNavItem[] = (sessionsQuery.data ?? []).map(item => ({ id: item.id, title: item.title, status: item.status, updatedAt: item.updatedAt }));

  function resetLiveState() {
    setLivePlan([]);
    setLiveSources([]);
    setLiveFindings([]);
    setActiveStepId(null);
    setLiveClarification(null);
    setLiveIntent(null);
    setActivityLog([]);
    setStreamMessage(null);
  }

  function recordActivity(activity: Omit<ResearchActivity, "timestamp">) {
    setActivityLog(current => appendResearchActivity(current, activity));
  }

  function openStream(sessionId: string) {
    streamRef.current?.close();
    resetLiveState();
    setSelectedSessionId(sessionId);
    const stream = new EventSource(`/api/research/stream/${sessionId}`);
    streamRef.current = stream;
    const onEvent = (event: MessageEvent) => {
      const data = JSON.parse(event.data);
      if (data.type === "connected") recordActivity({ phase: "planning", message: "Connected to the research workspace. Preparing the agent run.", progress: 3 });
      if (data.type === "activity") { recordActivity(data); setStreamMessage(data.message); }
      if (data.type === "intent") { setLiveIntent(data.intent); setStreamMessage(`Interpreting objective · ${data.intent.researchGoal}`); }
      if (data.type === "clarification") {
        const transition = applyClarificationTransition({ clarification: liveClarification, message: streamMessage, activities: activityLog }, data.question);
        setLiveClarification(transition.clarification);
        setStreamMessage(transition.message);
        setActivityLog(transition.activities);
        if (transition.shouldInvalidateSession) { void utils.research.get.invalidate({ sessionId }); void utils.research.list.invalidate(); }
        if (transition.shouldCloseStream) stream.close();
      }
      if (data.type === "plan") {
        setLivePlan(data.plan);
        setStreamMessage("Research plan is ready. Gathering public evidence.");
      }
      if (data.type === "step") {
        setActiveStepId(data.status === "active" ? data.stepId : null);
        setLivePlan(current => current.map(step => step.id === data.stepId ? { ...step, status: data.status } : step));
      }
      if (data.type === "sources") setLiveSources(current => [...current, ...data.sources]);
      if (data.type === "findings") setLiveFindings(current => [...current, ...data.findings]);
      if (data.type === "complete") {
        setStreamMessage("Research complete. Your cited brief is ready.");
        stream.close();
        void utils.research.get.invalidate({ sessionId });
        void utils.research.list.invalidate();
      }
      if (data.type === "error") {
        setStreamMessage(data.message);
        toast.error("Research execution stopped", { description: data.message });
        stream.close();
        void utils.research.get.invalidate({ sessionId });
        void utils.research.list.invalidate();
      }
    };
    ["connected", "activity", "intent", "clarification", "plan", "step", "sources", "findings", "complete", "error"].forEach(name => stream.addEventListener(name, onEvent));
    stream.onerror = () => {
      if (stream.readyState === EventSource.CLOSED) return;
      setStreamMessage("The research connection was interrupted. You can reopen this session to continue.");
      stream.close();
    };
  }

  async function startResearch() {
    if (query.trim().length < 8) {
      toast.error("Add a little more context", { description: "Research questions need at least eight characters." });
      return;
    }
    try {
      const created = await createResearch.mutateAsync({ query: query.trim(), researchDepth });
      if (!created) throw new Error("Unable to create the research session");
      setQuery("");
      await utils.research.list.invalidate();
      openStream(created.id);
    } catch (error) {
      toast.error("Could not start research", { description: error instanceof Error ? error.message : "Please retry." });
    }
  }

  async function submitClarification(answer: string) {
    if (!selectedSessionId || answer.trim().length < 2) return;
    await clarifyResearch.mutateAsync({ sessionId: selectedSessionId, answer });
    const transition = beginClarificationResume({ clarification: liveClarification, message: streamMessage, activities: activityLog });
    setLiveClarification(transition.clarification);
    setStreamMessage(transition.message);
    setActivityLog(transition.activities);
    if (transition.shouldInvalidateSession) await utils.research.get.invalidate({ sessionId: selectedSessionId });
    if (transition.shouldOpenStream) openStream(selectedSessionId);
  }

  async function exportSession(format: "markdown" | "html") {
    if (!selectedSessionId) return;
    try {
      const result = await createExport.mutateAsync({ sessionId: selectedSessionId, format });
      await utils.research.get.invalidate({ sessionId: selectedSessionId });
      window.open(result.storageUrl, "_blank", "noopener,noreferrer");
      toast.success(format === "markdown" ? "Markdown export stored" : "Print-ready HTML stored", { description: "The file is also available whenever you reopen this session." });
    } catch (error) {
      toast.error("Could not create export", { description: error instanceof Error ? error.message : "Please retry." });
    }
  }

  const isWorking = createResearch.isPending || session?.status === "planning" || session?.status === "researching" || Boolean(activeStepId);
  const isAwaitingClarification = Boolean(liveClarification) || session?.status === "awaiting_clarification";
  const displayStatus = liveClarification ? "awaiting_clarification" : session?.status;
  const outputFormat = liveIntent?.outputFormat ?? session?.outputFormat ?? "report";
  const displayTitle = session?.title || liveIntent?.title || "Preparing your research brief";
  const displayGoal = session?.researchGoal || liveIntent?.researchGoal || session?.query;

  return (
    <DashboardLayout sessions={sidebarSessions} selectedSessionId={selectedSessionId} isSessionsLoading={sessionsQuery.isLoading} sessionsError={Boolean(sessionsQuery.error)} onRetrySessions={() => void sessionsQuery.refetch()} onNewResearch={() => { resetLiveState(); setSelectedSessionId(null); setQuery(""); window.setTimeout(() => composerRef.current?.focus(), 0); }} onSelectSession={id => { streamRef.current?.close(); resetLiveState(); setSelectedSessionId(id); }} onSettings={() => toast("Research controls", { description: "Current prototype uses a cited public-source layer and stores completed work per signed-in user." })}>
      <div className="min-h-screen">
        <header className="flex min-h-16 items-center justify-between border-b border-border/80 px-5 sm:px-8 lg:px-10">
          <div className="flex items-center gap-3"><span className="font-mono-ui text-[10px] font-medium uppercase tracking-[0.18em] text-primary">Research workspace</span><span className="hidden h-1 w-1 rounded-full bg-muted-foreground/60 sm:inline" /><span className="hidden text-xs text-muted-foreground sm:inline">Plan · discover · synthesize</span></div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><span className="hidden sm:inline">Evidence-first mode</span><span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_0_4px_oklch(0.72_0.12_145/0.14)]" /></div>
        </header>

        <div className="mx-auto max-w-[1680px] px-5 py-8 sm:px-8 lg:px-10 lg:py-10">
          {!selectedSessionId ? (
            <section className="mx-auto grid max-w-5xl gap-8 pt-4 lg:grid-cols-[1.35fr_0.65fr] lg:pt-14">
              <div>
                <p className="font-mono-ui text-[11px] font-medium uppercase tracking-[0.18em] text-primary">A research colleague, not a search box</p>
                <h1 className="mt-5 max-w-3xl font-editorial text-5xl font-semibold leading-[0.95] tracking-[-0.045em] text-foreground sm:text-6xl lg:text-7xl">Bring the question that deserves <span className="text-primary">real thinking.</span></h1>
                <p className="mt-6 max-w-xl text-base leading-7 text-secondary-foreground">ResearchOS interprets your brief, makes the work visible, retrieves live public evidence, and turns the result into the format the question needs.</p>
                <div className="mt-10 rounded-[1.4rem] border border-border bg-card p-3 shadow-[0_24px_80px_-50px_oklch(0.25_0.014_250/0.45)]">
                  <Textarea ref={composerRef} value={query} onChange={event => setQuery(event.target.value)} placeholder="What do you need to understand, decide, compare, or explain?" className="min-h-36 resize-none border-0 bg-transparent px-3 pt-3 text-base leading-7 shadow-none focus-visible:ring-0" />
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 px-3 pt-3"><div className="flex flex-wrap items-center gap-3"><div className="flex items-center gap-2 font-mono-ui text-[10px] uppercase tracking-[0.12em] text-muted-foreground"><Search className="h-3.5 w-3.5 text-primary" /> Intent-aware · Cited evidence</div><Select value={researchDepth} onValueChange={value => setResearchDepth(value as keyof typeof depthOptions)}><SelectTrigger aria-label="Research depth" className="h-9 w-[196px] rounded-lg border-border bg-muted/45 text-left text-xs"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(depthOptions).map(([value, option]) => <SelectItem key={value} value={value} className="text-xs"><span className="font-medium">{option.label}</span><span className="ml-2 text-muted-foreground">· {option.detail}</span></SelectItem>)}</SelectContent></Select></div><Button onClick={startResearch} disabled={isWorking} className="h-10 rounded-xl px-4 shadow-[0_8px_20px_-12px_oklch(0.35_0.075_182)]">{isWorking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Start research</Button></div>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2">{exampleQueries.map(prompt => <button key={prompt} onClick={() => setQuery(prompt)} className="rounded-full border border-border bg-card px-3 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary">{prompt}</button>)}<span className="ml-1 font-mono-ui text-[10px] uppercase tracking-[0.1em] text-muted-foreground">Focus anytime <kbd className="rounded border border-border bg-card px-1 py-0.5 text-[9px]">⌘ K</kbd></span></div>
              </div>
              <aside className="self-end rounded-[1.5rem] bg-[#183e3b] p-6 text-[#f7f5e9] shadow-[0_24px_70px_-35px_oklch(0.24_0.07_182/0.7)] lg:mb-2"><div className="flex items-center justify-between"><Sparkles className="h-5 w-5 text-[#f4c978]" /><span className="font-mono-ui text-[10px] uppercase tracking-[0.15em] text-[#d7e1d2]/70">How it works</span></div><ol className="mt-7 space-y-5">{[["01", "Frame", "Clarify the decision and select the right deliverable."], ["02", "Investigate", "Execute a visible plan with live public-source discovery."], ["03", "Synthesize", "Return cited findings in the shape of the question."]].map(([number, title, description]) => <li key={number} className="grid grid-cols-[28px_1fr] gap-3"><span className="font-mono-ui text-[10px] text-[#f4c978]">{number}</span><div><h2 className="text-sm font-semibold">{title}</h2><p className="mt-1 text-xs leading-5 text-[#d7e1d2]/75">{description}</p></div></li>)}</ol><div className="mt-7 border-t border-[#d7e1d2]/15 pt-4 text-[11px] leading-5 text-[#d7e1d2]/65">Live source discovery is enabled through the available Manus Data API public-content provider. Each retained finding links to its underlying source.</div></aside>
            </section>
          ) : (
            <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
              <div className="min-w-0">
                <div className="border-b border-border pb-7">
                  <div className="flex flex-wrap items-center justify-between gap-3"><span className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-2.5 py-1 font-mono-ui text-[10px] font-medium uppercase tracking-[0.12em] text-primary"><span className={cn("h-1.5 w-1.5 rounded-full", displayStatus === "complete" ? "bg-emerald-500" : displayStatus === "failed" ? "bg-rose-500" : "bg-amber-500")} /> {statusLabel(displayStatus)}</span><span className="font-mono-ui text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Output · {outputFormat}</span></div>
                  <h1 className="mt-4 max-w-4xl font-editorial text-4xl font-semibold leading-tight tracking-[-0.035em] sm:text-5xl">{displayTitle}</h1>
                  <p className="mt-4 max-w-3xl text-sm leading-6 text-secondary-foreground">{displayGoal}</p>
                </div>

                {detailQuery.isLoading && <div className="mt-5 flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin text-primary" /> Loading this saved research session…</div>}
                {detailQuery.error && <div className="mt-5 flex items-start justify-between gap-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900"><div className="flex gap-2"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /><span>We could not load this session. {detailQuery.error.message}</span></div><Button size="sm" variant="outline" onClick={() => void detailQuery.refetch()} className="shrink-0 border-rose-200 bg-white text-rose-800"><ArrowRight className="mr-1 h-3.5 w-3.5" /> Retry</Button></div>}

                {streamMessage && <div className="mt-5 flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/[0.045] px-4 py-3 text-sm text-primary"><Loader2 className={cn("mt-0.5 h-4 w-4 shrink-0", isWorking && "animate-spin")} /><span>{streamMessage}</span></div>}
                {activityLog.length > 0 && <section className="mt-6 overflow-hidden rounded-2xl border border-primary/20 bg-primary/[0.035]"><div className="flex items-center justify-between gap-4 px-5 py-4"><div className="flex min-w-0 items-center gap-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Timer className={cn("h-4 w-4", (isWorking || !isAwaitingClarification) && "animate-pulse")} /></span><div><p className="font-mono-ui text-[10px] font-medium uppercase tracking-[0.15em] text-primary">Live research activity · {activityLog[activityLog.length - 1].phase}</p><p className="mt-1 text-sm leading-5 text-secondary-foreground">{activityLog[activityLog.length - 1].message}</p></div></div><span className="font-mono-ui text-xs text-primary">{activityLog[activityLog.length - 1].progress}%</span></div><div className="h-1 bg-primary/10"><div className="h-full bg-primary transition-all duration-500" style={{ width: `${Math.max(4, activityLog[activityLog.length - 1].progress)}%` }} /></div><div className="grid gap-1 border-t border-primary/10 px-5 py-3"><p className="font-mono-ui text-[9px] uppercase tracking-[0.12em] text-muted-foreground">Recent activity</p>{activityLog.slice(-3).reverse().map((activity, index) => <p key={`${activity.timestamp}-${index}`} className="truncate text-xs text-muted-foreground">{activity.message}</p>)}</div></section>}

                {isAwaitingClarification ? <ClarificationCard question={liveClarification?.question || session?.clarifyingQuestion || "What should the research prioritize?"} onSubmit={submitClarification} loading={clarifyResearch.isPending} /> : <>
                  {plan.length > 0 && <div className="mt-8"><div className="mb-3 flex items-center gap-2"><Layers3 className="h-4 w-4 text-primary" /><h2 className="font-mono-ui text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Research plan</h2></div><div className="grid gap-2">{plan.map((step, index) => { const isActive = activeStepId === step.id || step.status === "active"; const isDone = step.status === "complete"; const isSkipped = step.status === "skipped"; return <div key={step.id} className={cn("flex items-start gap-3 rounded-xl border px-4 py-3 transition-colors", isActive ? "border-primary/30 bg-primary/[0.045]" : isSkipped ? "border-amber-200 bg-amber-50/35" : "border-border bg-card/60")}><span className={cn("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px]", isDone ? "border-emerald-500 bg-emerald-500 text-white" : isSkipped ? "border-amber-400 bg-amber-100 text-amber-800" : isActive ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground")}>{isDone ? <Check className="h-3 w-3" /> : isSkipped ? <Clock3 className="h-3 w-3" /> : isActive ? <Loader2 className="h-3 w-3 animate-spin" /> : index + 1}</span><div className="min-w-0"><p className="text-sm font-medium">{step.title}</p><p className="mt-0.5 text-xs leading-5 text-muted-foreground">{step.description}</p></div>{isActive && <span className="ml-auto font-mono-ui text-[9px] uppercase tracking-[0.12em] text-primary">Working</span>}{isSkipped && <span className="ml-auto font-mono-ui text-[9px] uppercase tracking-[0.12em] text-amber-700">Skipped</span>}</div> })}</div></div>}
                  {allFindings.length > 0 && <div className="mt-10"><div className="mb-5 flex items-center justify-between"><div><p className="font-mono-ui text-[10px] font-medium uppercase tracking-[0.16em] text-primary">Evidence synthesis</p><h2 className="mt-1 font-editorial text-3xl font-semibold tracking-[-0.025em]">What the evidence suggests</h2></div><span className="hidden rounded-full bg-muted px-3 py-1 font-mono-ui text-[10px] uppercase tracking-[0.1em] text-muted-foreground sm:inline">{allFindings.length} findings</span></div>{session?.finalOutput && <div className="mb-7 rounded-2xl border border-border bg-card px-5 py-4 text-sm leading-6 text-secondary-foreground"><Streamdown>{session.finalOutput}</Streamdown></div>}<FindingsView outputFormat={outputFormat} findings={allFindings} sourceMap={sourceMap} /></div>}
                  {!plan.length && !isWorking && !session?.errorMessage && <div className="mt-16 rounded-2xl border border-dashed border-border bg-card/40 p-8 text-center"><FileText className="mx-auto h-5 w-5 text-primary" /><p className="mt-3 text-sm font-medium">This session is ready to begin.</p><p className="mt-1 text-xs text-muted-foreground">Open the research stream to generate the adaptive plan.</p><Button variant="outline" onClick={() => openStream(selectedSessionId)} className="mt-5 rounded-xl"><Play className="mr-2 h-3.5 w-3.5" /> Run research</Button></div>}
                  {session?.errorMessage && <div className="mt-8 rounded-2xl border border-rose-200 bg-rose-50 p-5 text-rose-900"><div className="flex gap-3"><CircleAlert className="mt-0.5 h-4 w-4" /><div><p className="text-sm font-semibold">Research paused</p><p className="mt-1 text-sm leading-6">{session.errorMessage}</p><Button variant="outline" onClick={() => openStream(selectedSessionId)} className="mt-4 border-rose-200 bg-white text-rose-800 hover:bg-rose-100"><ArrowRight className="mr-2 h-3.5 w-3.5" /> Try again</Button></div></div></div>}
                </>}
              </div>

              <aside className="xl:pt-2"><div className="sticky top-6 overflow-hidden rounded-[1.35rem] border border-border bg-card shadow-[0_18px_55px_-42px_oklch(0.24_0.014_250/0.7)]"><div className="flex items-center justify-between border-b border-border px-5 py-4"><div className="flex items-center gap-2"><PanelRightOpen className="h-4 w-4 text-primary" /><h2 className="text-sm font-semibold">References</h2></div><span className="rounded-full bg-muted px-2 py-0.5 font-mono-ui text-[10px] text-muted-foreground">{allSources.length}</span></div><div className="border-b border-border bg-muted/35 px-5 py-3"><p className="font-mono-ui text-[9px] uppercase tracking-[0.13em] text-muted-foreground">Source coverage</p><p className="mt-1 text-xs leading-5 text-secondary-foreground">Live discovery uses the currently available Manus Data API public-content provider. Citations link directly to every source used.</p></div><div className="max-h-[calc(100vh-360px)] space-y-3 overflow-y-auto p-3">{allSources.length ? allSources.map((source, index) => <a key={source.id} href={source.url} target="_blank" rel="noreferrer" className="group block rounded-xl p-3 transition-colors hover:bg-muted"><div className="flex gap-3"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-primary/10 font-mono-ui text-[10px] text-primary">{index + 1}</span><div className="min-w-0"><p className="line-clamp-2 text-xs font-semibold leading-5 group-hover:text-primary">{source.title}</p><p className="mt-1 text-[11px] text-muted-foreground">{source.publisher || "Public source"} · {formatDate(source.retrievedAt)}</p>{source.excerpt && <p className="mt-2 line-clamp-2 text-[11px] leading-5 text-secondary-foreground">{source.excerpt}</p>}</div></div></a>) : <div className="px-3 py-8 text-center"><Quote className="mx-auto h-4 w-4 text-primary" /><p className="mt-3 text-xs leading-5 text-muted-foreground">Sources discovered during research will appear here.</p></div>}</div>{session?.status === "complete" && <div className="border-t border-border p-3"><div className="grid grid-cols-2 gap-2"><Button disabled={createExport.isPending} onClick={() => void exportSession("markdown")} className="h-9 rounded-xl text-xs" variant="outline"><Download className="mr-1.5 h-3.5 w-3.5" /> Markdown</Button><Button disabled={createExport.isPending} onClick={() => void exportSession("html")} className="h-9 rounded-xl text-xs" variant="outline"><FileText className="mr-1.5 h-3.5 w-3.5" /> Print HTML</Button></div>{detailQuery.data?.exports?.length ? <div className="mt-3 border-t border-border pt-3"><p className="mb-2 font-mono-ui text-[9px] uppercase tracking-[0.12em] text-muted-foreground">Saved exports</p>{detailQuery.data.exports.map(exportFile => <a key={exportFile.id} href={exportFile.storageUrl} target="_blank" rel="noreferrer" className="mb-1 flex items-center justify-between rounded-lg px-2 py-1.5 text-xs text-secondary-foreground hover:bg-muted"><span>{exportFile.format === "markdown" ? "Markdown" : "Print HTML"}</span><ArrowRight className="h-3.5 w-3.5 text-primary" /></a>)}</div> : <p className="mt-2 text-center text-[10px] text-muted-foreground">Exports remain available from session history.</p>}</div>}</div></aside>
            </section>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

function ClarificationCard({ question, onSubmit, loading }: { question: string; onSubmit: (answer: string) => Promise<void>; loading: boolean }) {
  const [answer, setAnswer] = useState("");
  const clarificationRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => { clarificationRef.current?.focus(); }, []);
  return <div className="mt-8 rounded-[1.35rem] border border-amber-200 bg-amber-50/70 p-6"><div className="flex items-start gap-3"><Sparkles className="mt-0.5 h-5 w-5 text-amber-700" /><div><p className="font-mono-ui text-[10px] font-medium uppercase tracking-[0.15em] text-amber-700">One decision before we proceed</p><h2 className="mt-2 font-editorial text-2xl font-semibold leading-tight text-amber-950">{question}</h2></div></div><div className="mt-5 flex flex-col gap-3 sm:flex-row"><Textarea ref={clarificationRef} value={answer} onChange={event => setAnswer(event.target.value)} placeholder="Add the constraint, audience, time horizon, or decision context that matters most." className="min-h-20 resize-none border-amber-200 bg-white/80 text-sm" /><Button disabled={loading || answer.trim().length < 2} onClick={() => void onSubmit(answer)} className="h-10 shrink-0 rounded-xl self-end bg-amber-700 text-white hover:bg-amber-800"><ChevronRight className="mr-1 h-4 w-4" /> Continue</Button></div></div>;
}
