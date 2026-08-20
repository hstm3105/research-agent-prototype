import { useAuth } from "@/_core/hooks/useAuth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { startLogin } from "@/const";
import { useIsMobile } from "@/hooks/useMobile";
import { BookOpenText, ChevronRight, CircleAlert, FileSearch, Loader2, LogOut, PanelLeft, Plus, RefreshCw, Settings2 } from "lucide-react";
import { useEffect, useState } from "react";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";
import { Button } from "./ui/button";

export type ResearchSessionNavItem = {
  id: string;
  title: string;
  status: string;
  updatedAt: Date | string;
};

type DashboardLayoutProps = {
  children: React.ReactNode;
  sessions?: ResearchSessionNavItem[];
  selectedSessionId?: string | null;
  onNewResearch?: () => void;
  onSelectSession?: (sessionId: string) => void;
  onSettings?: () => void;
  isSessionsLoading?: boolean;
  sessionsError?: boolean;
  onRetrySessions?: () => void;
};

export default function DashboardLayout({
  children,
  sessions = [],
  selectedSessionId,
  onNewResearch,
  onSelectSession,
  onSettings,
  isSessionsLoading = false,
  sessionsError = false,
  onRetrySessions,
}: DashboardLayoutProps) {
  const { loading, user } = useAuth();
  const [sidebarWidth, setSidebarWidth] = useState(() => Number(localStorage.getItem("sidebar-width")) || 280);

  useEffect(() => {
    localStorage.setItem("sidebar-width", String(sidebarWidth));
  }, [sidebarWidth]);

  if (loading) return <DashboardLayoutSkeleton />;
  if (!user) return <div className="flex min-h-screen items-center justify-center bg-background px-5"><div className="max-w-md rounded-[1.5rem] border border-border bg-card p-8 text-center shadow-[0_24px_70px_-45px_oklch(0.24_0.014_250/0.55)]"><p className="font-mono-ui text-[10px] uppercase tracking-[0.16em] text-primary">ResearchOS</p><h1 className="mt-3 font-editorial text-4xl font-semibold tracking-[-0.03em]">Sign in to continue</h1><p className="mt-3 text-sm leading-6 text-muted-foreground">Your research history, citations, and stored exports are private to your account.</p><Button onClick={() => startLogin()} className="mt-7 h-11 w-full rounded-xl">Sign in</Button></div></div>;

  return <SidebarProvider style={{ "--sidebar-width": `${sidebarWidth}px` } as React.CSSProperties}><ResearchSidebar
    sessions={sessions}
    selectedSessionId={selectedSessionId}
    onNewResearch={onNewResearch}
    onSelectSession={onSelectSession}
    onSettings={onSettings}
    isSessionsLoading={isSessionsLoading}
    sessionsError={sessionsError}
    onRetrySessions={onRetrySessions}
    onResize={setSidebarWidth}
  >{children}</ResearchSidebar></SidebarProvider>;
}

type SidebarProps = Omit<DashboardLayoutProps, "children"> & { children: React.ReactNode; onResize: (width: number) => void };

function ResearchSidebar({ children, sessions = [], selectedSessionId, onNewResearch, onSelectSession, onSettings, isSessionsLoading, sessionsError, onRetrySessions, onResize }: SidebarProps) {
  const { user, logout } = useAuth();
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";
  const isMobile = useIsMobile();
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    if (!isResizing) return;
    const resize = (event: MouseEvent) => onResize(Math.min(480, Math.max(210, event.clientX)));
    const stop = () => setIsResizing(false);
    window.addEventListener("mousemove", resize);
    window.addEventListener("mouseup", stop);
    document.body.style.cursor = "col-resize";
    return () => { window.removeEventListener("mousemove", resize); window.removeEventListener("mouseup", stop); document.body.style.cursor = ""; };
  }, [isResizing, onResize]);

  return <>
    <div className="relative">
      <Sidebar collapsible="icon" className="border-r-0" disableTransition={isResizing}>
        <SidebarHeader className="h-auto py-4">
          <div className="flex w-full items-center gap-3 px-2"><button onClick={toggleSidebar} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-accent" aria-label="Toggle navigation"><PanelLeft className="h-4 w-4 text-muted-foreground" /></button>{!isCollapsed && <div className="min-w-0"><p className="font-editorial text-xl font-semibold leading-none">ResearchOS</p><p className="mt-1 font-mono-ui text-[9px] uppercase tracking-[0.18em] text-muted-foreground">Evidence workspace</p></div>}</div>
          <div className="px-2 pt-4 group-data-[collapsible=icon]:hidden"><Button onClick={onNewResearch} className="h-10 w-full justify-start gap-2 rounded-xl shadow-[0_8px_24px_-12px_oklch(0.35_0.075_182)]"><Plus className="h-4 w-4" /> New research</Button></div>
        </SidebarHeader>
        <SidebarContent className="gap-0 px-2 pt-4"><div className="mb-2 flex items-center justify-between px-2 group-data-[collapsible=icon]:hidden"><span className="font-mono-ui text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Recent research</span><BookOpenText className="h-3.5 w-3.5 text-muted-foreground" /></div><SidebarMenu className="gap-1 px-0">
          {isSessionsLoading ? Array.from({ length: 3 }).map((_, index) => <div key={index} className="flex h-12 items-center gap-3 rounded-xl px-3 group-data-[collapsible=icon]:hidden"><Loader2 className="h-3.5 w-3.5 animate-spin text-primary/55" /><span className="h-2.5 flex-1 rounded-full bg-muted" /></div>) : sessionsError ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-3 text-xs leading-5 text-rose-800 group-data-[collapsible=icon]:hidden"><div className="flex gap-2"><CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />History could not be loaded.</div><button onClick={onRetrySessions} className="mt-2 inline-flex items-center gap-1 font-medium text-rose-900 hover:underline"><RefreshCw className="h-3 w-3" /> Retry</button></div> : sessions.length ? sessions.map(session => <SidebarMenuItem key={session.id}><SidebarMenuButton isActive={selectedSessionId === session.id} onClick={() => onSelectSession?.(session.id)} tooltip={session.title} className="h-auto min-h-11 items-start rounded-xl py-2.5"><FileSearch className={`mt-0.5 h-4 w-4 shrink-0 ${selectedSessionId === session.id ? "text-primary" : "text-muted-foreground"}`} /><span className="flex min-w-0 flex-1 flex-col gap-1 group-data-[collapsible=icon]:hidden"><span className="truncate text-sm font-medium leading-none">{session.title}</span><span className="flex items-center gap-1.5 font-mono-ui text-[9px] uppercase tracking-wide text-muted-foreground"><span className={`h-1.5 w-1.5 rounded-full ${session.status === "complete" ? "bg-emerald-500" : session.status === "failed" ? "bg-rose-500" : "bg-amber-500"}`} />{session.status.replace(/_/g, " ")}</span></span></SidebarMenuButton></SidebarMenuItem>) : <div className="rounded-xl border border-dashed border-border px-3 py-4 text-xs leading-relaxed text-muted-foreground group-data-[collapsible=icon]:hidden">Your research sessions will collect here.</div>}
        </SidebarMenu></SidebarContent>
        <SidebarFooter className="gap-2 p-3"><button onClick={onSettings} className="flex h-9 w-full items-center gap-3 rounded-lg px-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground group-data-[collapsible=icon]:justify-center"><Settings2 className="h-4 w-4 shrink-0" /><span className="group-data-[collapsible=icon]:hidden">Research settings</span><ChevronRight className="ml-auto h-3.5 w-3.5 group-data-[collapsible=icon]:hidden" /></button><DropdownMenu><DropdownMenuTrigger asChild><button className="flex w-full items-center gap-3 rounded-lg px-1 py-1 text-left transition-colors hover:bg-accent/50 group-data-[collapsible=icon]:justify-center"><Avatar className="h-9 w-9 shrink-0 border"><AvatarFallback className="text-xs font-medium">{user?.name?.charAt(0).toUpperCase()}</AvatarFallback></Avatar><div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden"><p className="truncate text-sm font-medium leading-none">{user?.name || "-"}</p><p className="mt-1.5 truncate text-xs text-muted-foreground">{user?.email || "-"}</p></div></button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-48"><DropdownMenuItem onClick={logout} className="cursor-pointer text-destructive focus:text-destructive"><LogOut className="mr-2 h-4 w-4" />Sign out</DropdownMenuItem></DropdownMenuContent></DropdownMenu></SidebarFooter>
      </Sidebar>
      <div className={`absolute right-0 top-0 h-full w-1 cursor-col-resize transition-colors hover:bg-primary/20 ${isCollapsed ? "hidden" : ""}`} onMouseDown={() => setIsResizing(true)} />
    </div>
    <SidebarInset className="min-w-0">{isMobile && <div className="sticky top-0 z-40 flex h-14 items-center border-b bg-background/95 px-2 backdrop-blur"><SidebarTrigger className="h-9 w-9 rounded-lg bg-background" /><span className="ml-2 font-editorial text-lg">ResearchOS</span></div>}<main className="flex-1">{children}</main></SidebarInset>
  </>;
}
